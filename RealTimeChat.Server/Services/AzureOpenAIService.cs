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

    public interface IAzureOpenAIRealtimeService

    {

        Task StreamRealtimeResponseAsync(Func<string, string, Task> onChunkReceived, ConcurrentQueue<string> audioQueue, CancellationToken cancellationToken);

    }



    public class AzureOpenAIRealtimeService : IAzureOpenAIRealtimeService

    {

        private readonly string _endpoint;

        private readonly string _deployment;

        private readonly string _apiKey;

        private readonly string _apiVersion;



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



        public async Task StreamRealtimeResponseAsync(Func<string, string, Task> onChunkReceived, ConcurrentQueue<string> audioQueue, CancellationToken cancellationToken)

        {

            var uri = $"{_endpoint}/openai/realtime?api-version={_apiVersion}&deployment={_deployment}";

            using var ws = new ClientWebSocket();

            ws.Options.SetRequestHeader("api-key", _apiKey);

            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls13;

            string instructions =

            @"- Act as a real-time speech-to-speech interview chat-bot. 

             - Start interview with greetings and introduction. 

             - Ask one introductory question based on the specified topics and observe the user's answer. 

             - Follow up with relevant, additional questions according to the user's responses. 

             - Make sure to not answer the questions you are asking only ask follow up question, you can include some details if necessary. 

             - Use following topics with the format: [Topic]: [Sub Topics] - [Knowledge Depth] - [Difficulty Level] - [Interview Style] - ask [Question Count] question . to ask questions 

             - Once all topics are covered end the interview 

 

            Topics to cover: 

            - ASP.NET C# Basics: Introduction to ASP.NET, Overview of the .NET Framework & .NET Core, Common Language Runtime (CLR), and the differences between Web Forms and MVC - Beginner - Easy - Knowledge - ask 1 question  

            - ASP.NET MVC: Understanding the Model-View-Controller Architecture, Routing, Controllers, Views, and Filters - Beginner - Easy - Knowledge - ask 1 question  

            - C# Fundamentals: C# Syntax, Data Types, Variables, Operators, and Control Statements (if, switch, loops) - Beginner - Easy - Knowledge - ask 1 question  

            - Object-Oriented Programming in C#: OOP Concepts including Inheritance, Polymorphism, Encapsulation, Abstraction, Classes, Objects, and Interfaces - Intermediate - Moderate - Knowledge - ask 1 question  

            - ASP.NET Advanced Topics: Dependency Injection, Middleware, Web API Development, and Data Access using Entity Framework Core - Intermediate - Moderate - Knowledge - ask 1 question  

 

            Focus on these topics and related concepts throughout the interview.";

            try

            {

                Console.WriteLine("Connecting to WebSocket...");

                await ws.ConnectAsync(new Uri(uri), cancellationToken);

                Console.WriteLine("Connected.");



                var buffer = new byte[4096];

                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                var message = Encoding.UTF8.GetString(buffer, 0, result.Count);

                if (!message.Contains("session.created"))

                {

                    await onChunkReceived("[Error: Did not receive session.created]", "system-error");

                    return;

                }



                var sessionUpdate = new

                {

                    type = "session.update",

                    session = new

                    {

                        voice = "ash",

                        instructions = instructions,

                        input_audio_format = "pcm16",

                        output_audio_format = "pcm16",

                        input_audio_transcription = new { model = "whisper-1" },

                        turn_detection = new

                        {

                            type = "server_vad",

                            threshold = 0.7,

                            prefix_padding_ms = 300,

                            silence_duration_ms = 2000,

                            create_response = true

                        },

                        tools = new object[] { }

                    }

                };

                string sessionUpdateJson = JsonSerializer.Serialize(sessionUpdate);

                var bytesToSend = Encoding.UTF8.GetBytes(sessionUpdateJson);

                await ws.SendAsync(new ArraySegment<byte>(bytesToSend), WebSocketMessageType.Text, true, cancellationToken);



                var responseCreate = new

                {

                    type = "response.create",

                    response = new

                    {

                        modalities = new[] { "audio", "text" },

                        instructions = instructions

                    }

                };

                string responseCreateJson = JsonSerializer.Serialize(responseCreate);

                bytesToSend = Encoding.UTF8.GetBytes(responseCreateJson);

                await ws.SendAsync(new ArraySegment<byte>(bytesToSend), WebSocketMessageType.Text, true, cancellationToken);



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



                var textBuffer = new StringBuilder(); // Buffer for text chunks 



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

                            await onChunkReceived("[Connection Closed]", "system-info");

                            return;

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

                            //case "response.audio.delta":

                            //    if (root.TryGetProperty("delta", out var audioElement))

                            //    {

                            //        var audioContent = audioElement.GetString();

                            //        if (!string.IsNullOrEmpty(audioContent))

                            //            await onChunkReceived(audioContent, "system-audio");

                            //    }

                            //    break;

                            case "response.audio_transcript.delta": // AI's text (delta)
                                if (root.TryGetProperty("delta", out var transcriptElement))
                                {
                                    var textContent = transcriptElement.GetString();
                                    if (!string.IsNullOrEmpty(textContent))
                                        // No change needed here - send as delta
                                        await onChunkReceived(textContent, "system-text-delta");
                                }
                                break;

                            case "response.done":

                                await onChunkReceived("", "system-text-complete"); // Send empty msg just to signal completion maybe? Or rely on client buffering. Let's keep sending complete signal.

                                //if (textBuffer.Length > 0)

                                //{

                                //    var fullMessage = textBuffer.ToString().Trim();

                                //    await onChunkReceived(fullMessage, "system-text-complete");

                                //    textBuffer.Clear(); // Reset buffer 

                                //}

                                break;

                            case "conversation.item.input_audio_transcription.completed":

                                if (root.TryGetProperty("transcript", out var inputTranscriptElement))

                                {

                                    var textContent = inputTranscriptElement.GetString();

                                    if (!string.IsNullOrEmpty(textContent))

                                        textBuffer.Append(textContent + " ");

                                    await onChunkReceived(textContent, "user-text-delta"); // Send delta for buffering 

                                }

                                break;

                            case "error":

                                if (root.TryGetProperty("message", out var errorMsg))

                                    await onChunkReceived($"[Server Error: {errorMsg.GetString()}]", "system-error");

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