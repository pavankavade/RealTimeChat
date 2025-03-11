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
        private static readonly ConcurrentDictionary<string, CancellationTokenSource> _micTokenSources = new();

        public StreamingHub(IAzureOpenAIRealtimeService azureRealtimeService)
        {
            _azureRealtimeService = azureRealtimeService;
        }

        public async Task SendMessage(string user, string message)
        {
            try
            {
                await Clients.All.SendAsync("ReceiveMessage", user, message, "user");
            }
            catch (Exception ex)
            {
                await Clients.Caller.SendAsync("ReceiveMessage", "System", $"[Error: {ex.Message}]", "system-error");
            }
        }

        public async Task StartMic()
        {
            // If already streaming for this connection, just return.
            if (_micTokenSources.ContainsKey(Context.ConnectionId))
                return;

            // Create a cancellation token and audio queue for this connection.
            var cts = new CancellationTokenSource();
            _micTokenSources[Context.ConnectionId] = cts;
            var audioQueue = new ConcurrentQueue<string>();
            _audioQueues[Context.ConnectionId] = audioQueue;

            // Send initial mic status to the client.
            await Clients.Caller.SendAsync("MicStatus", true);

            // Capture the caller proxy to use in the background task.
            var caller = Clients.Caller;

            // Fire off the long-running streaming operation without awaiting it.
            _ = Task.Run(async () =>
            {
                try
                {
                    await _azureRealtimeService.StreamRealtimeResponseAsync(
                        async (chunk, chunkType) =>
                        {
                            // Send chunk response back to caller.
                            await caller.SendAsync("ReceiveMessage", "System", chunk, chunkType);
                        },
                        audioQueue,
                        cts.Token
                    );
                }
                catch (Exception ex)
                {
                    await caller.SendAsync("ReceiveMessage", "System", $"[Error: {ex.Message}]", "system-error");
                }
            });

            // Return immediately so client sees promise resolution (i.e. "StartMic invoked successfully")
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