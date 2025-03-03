using Microsoft.AspNetCore.SignalR;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

public class StreamingHub : Hub
{
    public ChannelReader<string> StreamText(CancellationToken cancellationToken)
    {
        var channel = Channel.CreateUnbounded<string>();

        _ = Task.Run(async () =>
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await channel.Writer.WriteAsync("Dummy text " + DateTime.Now.ToString(), cancellationToken);
                await Task.Delay(1000, cancellationToken); // Stream every 1 second
            }
            channel.Writer.Complete();
        });

        return channel.Reader;
    }
}