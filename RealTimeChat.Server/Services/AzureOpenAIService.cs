using System;
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
    /// <summary>
    /// Interface defining the contract for real-time interaction with Azure OpenAI via WebSocket.
    /// </summary>
    public interface IAzureOpenAIRealtimeService
    {
        /// <summary>
        /// Connects to the realtime API using a WebSocket and streams responses.
        /// </summary>
        /// <param name="onChunkReceived">Callback for every chunk received with content and its type</param>
        /// <param name="audioQueue">Queue containing audio chunks to be sent to the server</param>
        /// <param name="cancellationToken">Allows cancellation (stop streaming)</param>
        Task StreamRealtimeResponseAsync(Func<string, string, Task> onChunkReceived, ConcurrentQueue<string> audioQueue, CancellationToken cancellationToken);
    }

    /// <summary>
    /// Service for streaming real-time responses from Azure OpenAI using WebSockets.
    /// </summary>
    public class AzureOpenAIRealtimeService : IAzureOpenAIRealtimeService
    {
        private readonly string _endpoint;
        private readonly string _deployment;
        private readonly string _apiKey;
        private readonly string _apiVersion;

        /// <summary>
        /// Initializes a new instance of the AzureOpenAIRealtimeService with configuration settings.
        /// </summary>
        /// <param name="configuration">Configuration containing Azure OpenAI settings</param>
        /// <exception cref="ArgumentException">Thrown if configuration is incomplete</exception>
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

        /// <summary>
        /// Streams real-time responses from Azure OpenAI over a WebSocket connection.
        /// </summary>
        /// <param name="onChunkReceived">Callback invoked for each received chunk</param>
        /// <param name="audioQueue">Queue of audio chunks to send to the server</param>
        /// <param name="cancellationToken">Token to cancel the operation</param>
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

                // Receive session.created
                var buffer = new byte[4096];
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                if (!message.Contains("session.created"))
                {
                    await onChunkReceived("[Error: Did not receive session.created]", "system-error");
                    return;
                }

                // Send session.update with audio configuration
                var sessionUpdate = new
                {
                    type = "session.update",
                    session = new
                    {
                        voice = "alloy",
                        instructions = "Assist the user with speech-to-speech interaction.",
                        input_audio_format = "pcm16",
                        output_audio_format = "pcm16", // Added for output audio
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

                // Send response.create to initiate interaction
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

                // Audio sending task
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

                // Updated receive loop to handle fragmented messages
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
                            await onChunkReceived($"[Connection Closed]", "system-info");
                            return; // Exit the method since the connection is closed
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
                                        await onChunkReceived(textContent, "system-text");
                                }
                                break;
                            case "error":
                                if (root.TryGetProperty("message", out var errorMsg))
                                    await onChunkReceived($"[Server Error: {errorMsg.GetString()}]", "system-error");
                                break;
                            case "response.done":
                                Console.WriteLine("Response completed.");
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