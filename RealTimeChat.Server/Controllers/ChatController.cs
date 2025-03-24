using Microsoft.AspNetCore.Mvc;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using System.Text;
using System.Net.Http;
using Newtonsoft.Json;

namespace YourApp.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ChatController : ControllerBase
    {
        private readonly IConfiguration _configuration;
        private readonly IHttpClientFactory _httpClientFactory;

        public ChatController(IConfiguration configuration, IHttpClientFactory httpClientFactory)
        {
            _configuration = configuration;
            _httpClientFactory = httpClientFactory;
        }

        [HttpPost]
        public async Task<IActionResult> Chat([FromBody] ChatRequest request)
        {
            if (string.IsNullOrEmpty(request.Message))
                return BadRequest(new { error = "Message is required" });

            try
            {
                string aiText = await GetOpenAIResponse(request.Message);
                var (audioData, visemes) = await TextToSpeech(aiText);

                var response = new
                {
                    response = aiText,
                    audio = Convert.ToBase64String(audioData), // Send audio as Base64 string
                    visemes
                };
                return Ok(response);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error: {ex.Message}");
                return StatusCode(500, new { error = "Processing failed" });
            }
        }

        private async Task<string> GetOpenAIResponse(string message)
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"{_configuration["AzureOpenAIGPT4o:Endpoint"]}/openai/deployments/{_configuration["AzureOpenAIGPT4o:Deployment"]}/chat/completions?api-version={_configuration["AzureOpenAIGPT4o:ApiVersion"]}";
            var payload = new
            {
                messages = new[] { new { role = "user", content = message } }
            };

            client.DefaultRequestHeaders.Add("api-key", _configuration["AzureOpenAIGPT4o:ApiKey"]);
            var content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");
            var response = await client.PostAsync(url, content);
            response.EnsureSuccessStatusCode();

            var jsonResponse = await response.Content.ReadAsStringAsync();
            dynamic result = JsonConvert.DeserializeObject(jsonResponse);

            // Check if the message has a content property
            string aiText = "";
            try
            {
                // Attempt to obtain content if available
                if (result?.choices is Newtonsoft.Json.Linq.JArray && result.choices.Count > 0)
                {
                    var messageToken = result.choices[0]?.message;
                    // If the API response contains content, assign it.
                    if (messageToken != null && messageToken.content != null)
                    {
                        aiText = messageToken.content.ToString().Trim();
                    }
                    else
                    {
                        // Optionally, you could examine other fields such as finish_reason or refusal for more details.
                        aiText = "The response content was filtered or is not available.";
                    }
                }
            }
            catch (Exception ex)
            {
                // Log the exception as needed and rethrow or handle
                Console.WriteLine($"Error parsing OpenAI response: {ex.Message}");
                throw new Exception("Error occurred while processing the AI response.");
            }

            return aiText;
        }

        private async Task<(byte[] audioData, List<VisemeData> visemes)> TextToSpeech(string text)
        {
            var ssml = BuildSSML(text);
            var speechConfig = SpeechConfig.FromSubscription(
                _configuration["AzureSpeech:Key"],
                _configuration["AzureSpeech:Region"]
            );

            // Use null AudioConfig to avoid playing on server
            using var synthesizer = new SpeechSynthesizer(speechConfig, null);
            synthesizer.Properties.SetProperty(
                "SpeechSynthesisOutputFormat",
                SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3.ToString()
            );

            var visemes = new List<VisemeData>();
            synthesizer.VisemeReceived += (s, e) =>
            {
                visemes.Add(new VisemeData
                {
                    Offset = (long)e.AudioOffset / 10000, // Explicit cast from ulong to long
                    Id = (int)e.VisemeId                  // Explicit cast from uint to int
                });
            };

            var result = await synthesizer.SpeakSsmlAsync(ssml);
            if (result.Reason != ResultReason.SynthesizingAudioCompleted)
                throw new Exception("Speech synthesis failed");

            return (result.AudioData, visemes);
        }

        private string BuildSSML(string message)
        {
            return $@"<speak version=""1.0"" xmlns=""http://www.w3.org/2001/10/synthesis"" xmlns:mstts=""https://www.w3.org/2001/mstts"" xml:lang=""en-US"">
                <voice name=""{_configuration["AzureSpeech:VoiceName"]}"">
                            <prosody rate=""0%"" pitch=""0%"">
                                {message}
                            </prosody>
                        </voice>
            </speak>";
        }
    }

    public class ChatRequest
    {
        public string Message { get; set; }
    }

    public class VisemeData
    {
        public long Offset { get; set; }
        public int Id { get; set; }
    }
}