// StreamingHub.cs
using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

public class StreamingHub : Hub
{
    private readonly IAzureOpenAIService _azureOpenAIService;

    public StreamingHub(IAzureOpenAIService azureOpenAIService)
    {
        _azureOpenAIService = azureOpenAIService;
    }

    // StreamingHub.cs
    public async Task SendMessage(string user, string message)
    {
        // Send original message to all clients immediately, indicating it's a user message
        await Clients.All.SendAsync("ReceiveMessage", user, message, "user");  // Add "user" type

        // Stream AI response, indicating it's a system message
        await _azureOpenAIService.StreamChatResponseAsync(message, async (chunk) =>
        {
            await Clients.All.SendAsync("ReceiveMessage", "System", chunk, "system"); // Add "system" type
        });
    }
}