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
        private static readonly ConcurrentDictionary<string, ConcurrentQueue<string>> _audioQueues = new();

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

        public async Task StartMic()
        {
            if (_micTokenSources.ContainsKey(Context.ConnectionId)) return;

            var cts = new CancellationTokenSource();
            _micTokenSources[Context.ConnectionId] = cts;
            var audioQueue = new ConcurrentQueue<string>();
            _audioQueues[Context.ConnectionId] = audioQueue;

            await Clients.Caller.SendAsync("MicStatus", true);

            try
            {
                await _azureRealtimeService.StreamRealtimeResponseAsync(
                  async (chunk, chunkType) => await Clients.Caller.SendAsync("ReceiveMessage", "System", chunk, chunkType),
                  audioQueue,
                  cts.Token
                );
            }
            catch (Exception ex)
            {
                await Clients.Caller.SendAsync("ReceiveMessage", "System", $"[Error: {ex.Message}]", "system-error");
            }
        }

        public async Task SendAudioChunk(string audioChunk)
        {
            if (_audioQueues.TryGetValue(Context.ConnectionId, out var audioQueue))
            {
                audioQueue.Enqueue(audioChunk);
            }
        }

        public async Task StopMic()
        {
            if (_micTokenSources.TryRemove(Context.ConnectionId, out var cts))
            {
                cts.Cancel();
                _audioQueues.TryRemove(Context.ConnectionId, out _);
                await Clients.Caller.SendAsync("MicStatus", false);
            }
        }
    }
}