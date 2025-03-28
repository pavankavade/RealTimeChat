﻿using System;
using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Security.Authentication;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace RealTimeChat.Services
{
    public interface IAzureOpenAIRealtimeService
    {
        Task StreamRealtimeResponseAsync(Func<string, string, Task> onChunkReceived, ConcurrentQueue<string> audioQueue, CancellationToken cancellationToken);
    }

    public class AzureOpenAIRealtimeService : IAzureOpenAIRealtimeService
    {
        private readonly string _endpoint;
        private readonly string _deployment;
        private readonly string _apiKey;
        private readonly string _apiVersion;

        public AzureOpenAIRealtimeService(IConfiguration configuration)
        {
            _endpoint = configuration["AzureOpenAI:Endpoint"];
            _deployment = configuration["AzureOpenAI:Deployment"];
            _apiKey = configuration["AzureOpenAI:ApiKey"];
            _apiVersion = configuration["AzureOpenAI:ApiVersion"];

            if (string.IsNullOrWhiteSpace(_endpoint) ||
                string.IsNullOrWhiteSpace(_deployment) ||
                string.IsNullOrWhiteSpace(_apiKey) ||
                string.IsNullOrWhiteSpace(_apiVersion))
            {
                throw new ArgumentException("Azure OpenAI configuration is incomplete. Please check your appsettings.json.");
            }
        }

        public async Task StreamRealtimeResponseAsync(Func<string, string, Task> onChunkReceived, ConcurrentQueue<string> audioQueue, CancellationToken cancellationToken)
        {
            var uri = $"{_endpoint}/openai/realtime?api-version={_apiVersion}&deployment={_deployment}";
            using var ws = new ClientWebSocket();
            ws.Options.SetRequestHeader("api-key", _apiKey);
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls13;

            try
            {
                Console.WriteLine("Connecting to WebSocket...");
                await ws.ConnectAsync(new Uri(uri), cancellationToken);
                Console.WriteLine("Connected.");

                var buffer = new byte[4096];
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                if (!message.Contains("session.created"))
                {
                    await onChunkReceived("[Error: Did not receive session.created]", "system-error");
                    return;
                }

                var sessionUpdate = new
                {
                    type = "session.update",
                    session = new
                    {
                        voice = "alloy",
                        instructions = "Assist the user with speech-to-speech interaction.",
                        input_audio_format = "pcm16",
                        output_audio_format = "pcm16",
                        input_audio_transcription = new { model = "whisper-1" },
                        turn_detection = new
                        {
                            type = "server_vad",
                            threshold = 0.5,
                            prefix_padding_ms = 300,
                            silence_duration_ms = 200,
                            create_response = true
                        },
                        tools = new object[] { }
                    }
                };
                string sessionUpdateJson = JsonSerializer.Serialize(sessionUpdate);
                var bytesToSend = Encoding.UTF8.GetBytes(sessionUpdateJson);
                await ws.SendAsync(new ArraySegment<byte>(bytesToSend), WebSocketMessageType.Text, true, cancellationToken);

                var responseCreate = new
                {
                    type = "response.create",
                    response = new
                    {
                        modalities = new[] { "audio", "text" },
                        instructions = "Please assist the user."
                    }
                };
                string responseCreateJson = JsonSerializer.Serialize(responseCreate);
                bytesToSend = Encoding.UTF8.GetBytes(responseCreateJson);
                await ws.SendAsync(new ArraySegment<byte>(bytesToSend), WebSocketMessageType.Text, true, cancellationToken);

                var sendTask = Task.Run(async () =>
                {
                    while (!cancellationToken.IsCancellationRequested && ws.State == WebSocketState.Open)
                    {
                        if (audioQueue.TryDequeue(out var audioChunk))
                        {
                            var inputAudio = new { type = "input_audio_buffer.append", audio = audioChunk };
                            string inputJson = JsonSerializer.Serialize(inputAudio);
                            var audioBytes = Encoding.UTF8.GetBytes(inputJson);
                            await ws.SendAsync(new ArraySegment<byte>(audioBytes), WebSocketMessageType.Text, true, cancellationToken);
                        }
                        else
                        {
                            await Task.Delay(100, cancellationToken);
                        }
                    }
                }, cancellationToken);

                var textBuffer = new StringBuilder(); // Buffer for text chunks

                while (ws.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
                {
                    var messageBuilder = new StringBuilder();
                    WebSocketReceiveResult receiveResult;
                    do
                    {
                        receiveResult = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                        if (receiveResult.MessageType == WebSocketMessageType.Close)
                        {
                            await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", cancellationToken);
                            await onChunkReceived("[Connection Closed]", "system-info");
                            return;
                        }
                        messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, receiveResult.Count));
                    } while (!receiveResult.EndOfMessage);

                    message = messageBuilder.ToString();
                    using var document = JsonDocument.Parse(message);
                    var root = document.RootElement;

                    if (root.TryGetProperty("type", out var typeElement))
                    {
                        switch (typeElement.GetString())
                        {
                            case "response.audio.delta":
                                if (root.TryGetProperty("delta", out var audioElement))
                                {
                                    var audioContent = audioElement.GetString();
                                    if (!string.IsNullOrEmpty(audioContent))
                                        await onChunkReceived(audioContent, "system-audio");
                                }
                                break;
                            case "response.audio_transcript.delta":
                                if (root.TryGetProperty("delta", out var transcriptElement))
                                {
                                    var textContent = transcriptElement.GetString();
                                    if (!string.IsNullOrEmpty(textContent))
                                        textBuffer.Append(textContent + " ");
                                    await onChunkReceived(textContent, "system-text-delta"); // Send delta for buffering
                                }
                                break;
                            case "response.done":
                                if (textBuffer.Length > 0)
                                {
                                    var fullMessage = textBuffer.ToString().Trim();
                                    await onChunkReceived(fullMessage, "system-text-complete");
                                    textBuffer.Clear(); // Reset buffer
                                }
                                Console.WriteLine("Response completed.");
                                break;
                            case "error":
                                if (root.TryGetProperty("message", out var errorMsg))
                                    await onChunkReceived($"[Server Error: {errorMsg.GetString()}]", "system-error");
                                break;
                        }
                    }
                }

                await sendTask;
            }
            catch (Exception ex)
            {
                await onChunkReceived($"[Error: {ex.Message}]", "system-error");
            }
        }
    }
}