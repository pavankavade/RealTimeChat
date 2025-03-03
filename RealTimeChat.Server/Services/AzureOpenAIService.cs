// AzureOpenAIService.cs
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using OpenAI.Chat; // Make sure you have this using directive.
using System;
using System.Text; // Import StringBuilder
using System.Threading.Tasks;

public interface IAzureOpenAIService
{
    Task StreamChatResponseAsync(string message, Func<string, Task> onChunkReceived);
}

public class AzureOpenAIService : IAzureOpenAIService
{
    private readonly ChatClient _chatClient;

    public AzureOpenAIService(IConfiguration configuration)
    {
        var endpoint = configuration["AzureOpenAI:Endpoint"];
        var deployment = configuration["AzureOpenAI:Deployment"];
        var apiKey = configuration["AzureOpenAI:ApiKey"];

        if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(deployment))
        {
            throw new ArgumentException("Azure OpenAI configuration is incomplete in appsettings.json.");
        }

        AzureOpenAIClient azureClient;

        // Handle authentication based on whether an API key is provided
        if (string.IsNullOrEmpty(apiKey))
        {
            // Use DefaultAzureCredential for Azure AD-based auth
            azureClient = new AzureOpenAIClient(new Uri(endpoint), new DefaultAzureCredential());
        }
        else
        {
            // Use API key-based auth
            azureClient = new AzureOpenAIClient(new Uri(endpoint), new Azure.AzureKeyCredential(apiKey));
        }

        _chatClient = azureClient.GetChatClient(deployment);
    }

    public async Task StreamChatResponseAsync(string message, Func<string, Task> onChunkReceived)
    {
        try
        {
            var messages = new ChatMessage[]
            {
                new UserChatMessage(message)
            };

            // Use async streaming
            await foreach (var completionUpdate in _chatClient.CompleteChatStreamingAsync(messages))
            {
                StringBuilder chunkBuilder = new StringBuilder(); // Accumulate within the outer loop

                foreach (var contentPart in completionUpdate.ContentUpdate)
                {

                    if (!string.IsNullOrEmpty(contentPart.Text)) //this Text can sometimes be null
                    {
                        chunkBuilder.Append(contentPart.Text);
                    }
                }

                if (chunkBuilder.Length > 0) //check to ensure it has content before sending
                {
                    await onChunkReceived(chunkBuilder.ToString()); // Send the accumulated chunk
                }
            }
        }
        catch (Exception ex)
        {
            await onChunkReceived($"Error: {ex.Message}");
        }
    }
}