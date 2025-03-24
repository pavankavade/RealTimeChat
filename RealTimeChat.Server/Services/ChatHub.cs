using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RealTimeChat.Hubs
{
    public class ChatHub : Hub
    {
        private readonly IConfiguration _configuration;
        private readonly IHttpClientFactory _httpClientFactory;

        public ChatHub(IConfiguration configuration, IHttpClientFactory httpClientFactory)
        {
            _configuration = configuration;
            _httpClientFactory = httpClientFactory;
        }

        /// <summary>
        /// Called by the client to start processing the message.
        /// This method streams text from OpenAI and then processes the text in chunks
        /// for TTS audio synthesis and viseme events.
        /// </summary>
        public async Task SendMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message))
            {
                await Clients.Caller.SendAsync("Error", "Message is required.");
                return;
            }

            try
            {
                // Instead of streaming and processing each small text chunk immediately,
                // we buffer the text and process it in larger chunks.
                await ProcessMessageForSpeech(message);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error in ChatHub.SendMessage: " + ex.Message);
                await Clients.Caller.SendAsync("Error", "Processing failed: " + ex.Message);
            }
        }

        /// <summary>
        /// Buffers text chunks from the OpenAI stream and only processes them
        /// when a logical chunk (sentence end or max length) is reached.
        /// </summary>
        private async Task ProcessMessageForSpeech(string message)
        {
            var textBuffer = new StringBuilder();

            await foreach (var textChunk in GetOpenAIResponseStream(message))
            {
                // Append the new text.
                textBuffer.Append(textChunk);

                // When the accumulated text is “ready” (ends with punctuation,
                // or has reached a set length), synthesize this chunk.
                if (IsChunkReady(textBuffer.ToString()))
                {
                    string chunkToSynthesize = textBuffer.ToString().Trim();
                    textBuffer.Clear(); // Reset for the next chunk.

                    // Optionally, send the accumulated text to the client.
                    await Clients.Caller.SendAsync("ReceiveAIText", chunkToSynthesize);

                    // Process text to speech.
                    await foreach (var audioChunk in TextToSpeechStream(chunkToSynthesize))
                    {
                        await Clients.Caller.SendAsync("ReceiveAudioChunk", audioChunk);
                    }
                }
            }

            // Process any text remaining in the buffer.
            if (textBuffer.Length > 0)
            {
                var remainingText = textBuffer.ToString().Trim();
                await Clients.Caller.SendAsync("ReceiveAIText", remainingText);
                await foreach (var audioChunk in TextToSpeechStream(remainingText))
                {
                    await Clients.Caller.SendAsync("ReceiveAudioChunk", audioChunk);
                }
            }
        }

        /// <summary>
        /// Determines if the text should be processed now (ex: a sentence has ended or the buffer is long).
        /// </summary>
        private bool IsChunkReady(string text)
        {
            // Consider the chunk ready if it ends with punctuation,
            // or its length exceeds a chosen threshold.
            return text.EndsWith(".") ||
                   text.EndsWith("!") ||
                   text.EndsWith("?") ||
                   text.Length > 100; // Adjust the threshold as needed.
        }

        /// <summary>
        /// Streams the response from Azure OpenAI.
        /// This version extracts the content from the JSON response.
        /// </summary>
        private async IAsyncEnumerable<string> GetOpenAIResponseStream(string message)
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"{_configuration["AzureOpenAIGPT4o:Endpoint"]}/openai/deployments/{_configuration["AzureOpenAIGPT4o:Deployment"]}/chat/completions?api-version={_configuration["AzureOpenAIGPT4o:ApiVersion"]}";
            var payload = new
            {
                messages = new[] { new { role = "user", content = message } },
                stream = true
            };

            client.DefaultRequestHeaders.Remove("api-key");
            client.DefaultRequestHeaders.Add("api-key", _configuration["AzureOpenAIGPT4o:ApiKey"]);

            var content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = content
            };

            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, CancellationToken.None);
            response.EnsureSuccessStatusCode();

            using var stream = await response.Content.ReadAsStreamAsync();
            using var reader = new StreamReader(stream);
            while (!reader.EndOfStream)
            {
                var line = await reader.ReadLineAsync();
                if (!string.IsNullOrWhiteSpace(line))
                {
                    // Check if the line starts with "data:".
                    if (line.Trim().StartsWith("data:"))
                    {
                        // Remove the "data:" prefix.
                        var jsonPart = line.Substring(line.IndexOf("data:") + "data:".Length).Trim();

                        // Handle the completion indicator sent by OpenAI.
                        if (jsonPart == "[DONE]")
                        {
                            yield break;
                        }

                        string? chunkText = null;

                        try
                        {
                            var parsed = JObject.Parse(jsonPart);
                            // Safely extract the "content" field.
                            if (parsed["choices"] is JArray choices && choices.Count > 0)
                            {
                                var delta = choices[0]?["delta"];
                                if (delta != null && delta["content"] != null)
                                {
                                    chunkText = delta["content"].ToString();
                                }
                            }
                        }
                        catch (JsonReaderException jsonEx)
                        {
                            Console.WriteLine("JSON parse error: " + jsonEx.Message);
                        }

                        if (!string.IsNullOrWhiteSpace(chunkText))
                        {
                            yield return chunkText;
                        }
                    }
                }
            }
        }

        /// <summary>
        /// Converts the provided text to speech and streams its audio
        /// as a Base64-encoded string. It also wires up viseme events to stream them immediately.
        /// Uses a push stream to enable real-time audio chunking.
        /// </summary>
        private async IAsyncEnumerable<string> TextToSpeechStream(string text)
        {
            var ssml = BuildSSML(text);
            var speechConfig = SpeechConfig.FromSubscription(
                _configuration["AzureSpeech:Key"],
                _configuration["AzureSpeech:Region"]
            );

            // Create an instance of your callback implementation.
            var callback = new MyPushAudioOutputStreamCallback();

            // (Optional) Subscribe to the event to process audio chunks in real time.
            callback.OnChunkReceived += async (chunk) =>
            {
                // Immediately send out each audio chunk (Base64 encoded) to the client.
                await Clients.Caller.SendAsync("ReceiveAudioChunk", Convert.ToBase64String(chunk));
            };

            // Create a push output stream using the callback.
            using var pushStream = AudioOutputStream.CreatePushStream(callback);
            using var audioConfig = AudioConfig.FromStreamOutput(pushStream);

            // Create the speech synthesizer with the configured audio output.
            using var synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);

            // Wire up viseme events.
            synthesizer.VisemeReceived += async (s, e) =>
            {
                await Clients.Caller.SendAsync("ReceiveViseme", new
                {
                    Offset = (long)e.AudioOffset / 10000, // Convert from 100-nanosecond units to milliseconds.
                    Id = (int)e.VisemeId
                });
            };

            // Start synthesizing speech using SSML.
            var result = await synthesizer.SpeakSsmlAsync(ssml);
            if (result.Reason != ResultReason.SynthesizingAudioCompleted)
            {
                throw new Exception("Speech synthesis failed");
            }

            // Optionally, also send out the full synthesized audio once complete.
            string base64Audio = Convert.ToBase64String(result.AudioData);
            yield return base64Audio;
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
}