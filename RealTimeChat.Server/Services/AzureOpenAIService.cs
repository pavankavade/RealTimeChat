using System;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace RealTimeChat.Services
{
    public interface IAzureOpenAIRealtimeService
    {
        /// <summary>
        /// Connects to the realtime API using a WebSocket and streams responses.
        /// </summary>
        /// <param name="onChunkReceived">Callback for every chunk received with content and its type</param>
        /// <param name="cancellationToken">Allows cancellation (stop streaming)</param>
        Task StreamRealtimeResponseAsync(Func<string, string, Task> onChunkReceived, CancellationToken cancellationToken);
    }

    public class AzureOpenAIRealtimeService : IAzureOpenAIRealtimeService
    {
        private readonly string _endpoint;
        private readonly string _deployment;
        private readonly string _apiKey;
        private readonly string _apiVersion;

        public AzureOpenAIRealtimeService(IConfiguration configuration)
        {
            // Ensure your configuration has your endpoint, deployment, API key and API version.
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

        public async Task StreamRealtimeResponseAsync(Func<string, string, Task> onChunkReceived, CancellationToken cancellationToken)
        {
            // Build your secure WebSocket URI with the API key in the query string.
            var uri = $"{_endpoint}/openai/realtime?api-version={_apiVersion}&deployment={_deployment}&api-key={_apiKey}";

            using (var ws = new ClientWebSocket())
            {
                try
                {
                    await ws.ConnectAsync(new Uri(uri), cancellationToken);

                    // Send a session update event to configure the session.
                    var sessionUpdate = new
                    {
                        type = "session.update",
                        session = new
                        {
                            voice = "alloy",
                            instructions = "",
                            input_audio_format = "pcm16",
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

                    // Send a response.create event to start generation.
                    var responseCreate = new
                    {
                        type = "response.create",
                        response = new
                        {
                            commit = true,
                            cancel_previous = true,
                            instructions = "Please assist the user.",
                            modalities = new string[] { "text", "audio" }
                        }
                    };
                    string responseCreateJson = JsonSerializer.Serialize(responseCreate);
                    bytesToSend = Encoding.UTF8.GetBytes(responseCreateJson);
                    await ws.SendAsync(new ArraySegment<byte>(bytesToSend), WebSocketMessageType.Text, true, cancellationToken);

                    var buffer = new byte[4096];
                    while (ws.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
                    {
                        var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", cancellationToken);
                            break;
                        }

                        var messageJson = Encoding.UTF8.GetString(buffer, 0, result.Count);

                        // Process received JSON messages
                        try
                        {
                            using var document = JsonDocument.Parse(messageJson);
                            var root = document.RootElement;

                            // For example, check if the response payload includes choices with a delta content.
                            if (root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
                            {
                                var delta = choices[0].GetProperty("delta");
                                if (delta.TryGetProperty("content", out var contentElement))
                                {
                                    var content = contentElement.GetString();
                                    if (!string.IsNullOrEmpty(content))
                                    {
                                        await onChunkReceived(content, "system-text");
                                    }
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            await onChunkReceived($"[Error parsing chunk: {ex.Message}]", "system-error");
                        }
                    }
                }
                catch (Exception ex)
                {
                    await onChunkReceived($"[WebSocket Error: {ex.Message}]", "system-error");
                }
            }
        }
    }
}