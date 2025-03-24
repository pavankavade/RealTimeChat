using Microsoft.CognitiveServices.Speech.Audio;
using System;
using System.IO;

public class MyPushAudioOutputStreamCallback : PushAudioOutputStreamCallback
{
    // Optionally, you can collect the data into a MemoryStream.
    private readonly MemoryStream _buffer = new MemoryStream();

    // An event to notify when new audio chunks have been written.
    public event Action<byte[]> OnChunkReceived;

    public override uint Write(byte[] dataBuffer)
    {
        // Write the data to the buffer if needed.
        _buffer.Write(dataBuffer, 0, dataBuffer.Length);

        // Notify subscribers that a new chunk of audio data is available.
        OnChunkReceived?.Invoke(dataBuffer);

        return (uint)dataBuffer.Length;
    }
}