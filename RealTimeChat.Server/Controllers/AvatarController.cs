// AvatarController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.CognitiveServices.Speech;
using Microsoft.Extensions.Configuration;
using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

[Route("api/[controller]")]
[ApiController]
public class AvatarController : ControllerBase
{
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;

    public AvatarController(IConfiguration configuration, IHttpClientFactory httpClientFactory)
    {
        _configuration = configuration;
        _httpClientFactory = httpClientFactory;
    }

    // Simple DTO to return config to the client
    public class AvatarConfigResponse
    {
        public string Token { get; set; }
        public string Region { get; set; }
        public string IceServerUrl { get; set; }
        public string IceServerUsername { get; set; }
        public string IceServerPassword { get; set; }
        // Add other needed config like voice name, avatar character/style if desired
        public string TtsVoice { get; set; }
        public string AvatarCharacter { get; set; }
        public string AvatarStyle { get; set; }
    }

    // Simple DTO to parse the relay token response
    private class RelayTokenResponse
    {
        public string[] Urls { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
    }


    [HttpGet("config")]
    public async Task<ActionResult<AvatarConfigResponse>> GetAvatarConfig()
    {
        var speechKey = _configuration["AzureSpeech:SubscriptionKey"];
        var speechRegion = _configuration["AzureSpeech:Region"];

        if (string.IsNullOrEmpty(speechKey) || string.IsNullOrEmpty(speechRegion))
        {
            return BadRequest("Azure Speech configuration missing.");
        }

        try
        {
            var client = _httpClientFactory.CreateClient();
            string authToken;

            // 1. Get Authorization Token (short-lived) by calling the token endpoint
            var tokenUrl = $"https://{speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken";
            using (var request = new HttpRequestMessage(HttpMethod.Post, tokenUrl))
            {
                request.Headers.Add("Ocp-Apim-Subscription-Key", speechKey);
                // request.Content = new StringContent("", Encoding.UTF8, "application/x-www-form-urlencoded"); // Content can be empty
                var tokenResponse = await client.SendAsync(request);
                tokenResponse.EnsureSuccessStatusCode();
                authToken = await tokenResponse.Content.ReadAsStringAsync();
            }

            // 2. Get ICE Server Details (using HttpClient - existing code is fine)
            var relayTokenUrl = $"https://{speechRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1";
            // TODO: Add handling for private endpoints if needed

            client.DefaultRequestHeaders.Clear(); // Clear headers before adding new ones
            client.DefaultRequestHeaders.Add("Ocp-Apim-Subscription-Key", speechKey);
            var response = await client.GetAsync(relayTokenUrl);
            response.EnsureSuccessStatusCode();

            var relayTokenJson = await response.Content.ReadAsStringAsync();
            var relayTokenData = JsonSerializer.Deserialize<RelayTokenResponse>(relayTokenJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (relayTokenData?.Urls == null || relayTokenData.Urls.Length == 0)
            {
                throw new Exception("Failed to retrieve valid ICE server URL.");
            }

            var avatarConfig = new AvatarConfigResponse
            {
                Token = authToken, // Use the fetched token
                Region = speechRegion,
                IceServerUrl = relayTokenData.Urls[0],
                IceServerUsername = relayTokenData.Username,
                IceServerPassword = relayTokenData.Password,
                TtsVoice = _configuration.GetValue<string>("AzureSpeech:TtsVoice", "en-US-AvaMultilingualNeural"),
                AvatarCharacter = _configuration.GetValue<string>("AzureSpeech:AvatarCharacter", "lisa"),
                AvatarStyle = _configuration.GetValue<string>("AzureSpeech:AvatarStyle", "casual-sitting")
            };

            return Ok(avatarConfig);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error getting avatar config: {ex}");
            return StatusCode(500, "Failed to retrieve avatar configuration.");
        }
    }
}