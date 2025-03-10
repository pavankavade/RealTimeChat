using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using RealTimeChat.Services;
using RealTimeChat.Hubs;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddScoped<IAzureOpenAIRealtimeService, AzureOpenAIRealtimeService>();
builder.Services.AddSignalR();
builder.Services.AddHttpClient();

builder.Services.AddCors(options =>
{
options.AddPolicy("CorsPolicy",
    builder => builder.WithOrigins("https://localhost:4200")
                      .AllowAnyMethod()
                      .AllowAnyHeader()
                      .AllowCredentials());
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseCors("CorsPolicy");
app.UseAuthorization();

app.MapControllers();
app.MapHub<StreamingHub>("/chatstream"); // Updated to match client URL
app.MapFallbackToFile("/index.html");

app.Run();