// StreamingHub.cs
using Microsoft.AspNetCore.SignalR;
using RealTimeChat.Services;
using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

namespace RealTimeChat.Hubs
{
    public class StreamingHub : Hub
    {
        private readonly IAzureOpenAIRealtimeService _azureRealtimeService;

        // Dictionary to keep track of mic streams (one per connection)
        private static readonly ConcurrentDictionary<string, CancellationTokenSource> _micTokenSources = new();

        public StreamingHub(IAzureOpenAIRealtimeService azureRealtimeService)
        {
            _azureRealtimeService = azureRealtimeService;
        }

        // Method for user sending a regular text message
        public async Task SendMessage(string user, string message)
        {
            try
            {
                await Clients.All.SendAsync("ReceiveMessage", user, message, "user");
            }
            catch (Exception ex)
            {
                // Log or handle exception as needed
                await Clients.Caller.SendAsync("ReceiveMessage", "System", $"[Error: {ex.Message}]", "system-error");
            }
        }

        // Called from the client when the mic is enabled
        public async Task StartMic()
        {
            if (_micTokenSources.ContainsKey(Context.ConnectionId))
            {
                // Already started – nothing to do.
                return;
            }

            var cts = new CancellationTokenSource();
            _micTokenSources[Context.ConnectionId] = cts;

            // Inform the client that the mic is now enabled.
            await Clients.Caller.SendAsync("MicStatus", true);

            try
            {
                // Call the realtime API via WebSocket. Stream each delta chunk to ONLY the caller.
                await _azureRealtimeService.StreamRealtimeResponseAsync(async (chunk, chunkType) =>
                {
                    await Clients.Caller.SendAsync("ReceiveMessage", "System", chunk, chunkType);
                }, cts.Token);
            }
            catch (Exception ex)
            {
                await Clients.Caller.SendAsync("ReceiveMessage", "System", $"[Error: {ex.Message}]", "system-error");
            }
        }

        // Called from the client when the mic is muted
        public async Task StopMic()
        {
            if (_micTokenSources.TryRemove(Context.ConnectionId, out var cts))
            {
                cts.Cancel();
                await Clients.Caller.SendAsync("MicStatus", false);
            }
        }
    }
}