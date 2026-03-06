using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace NtoBot
{
    class Program
    {
        static string rootPath;
        static string serverPath;

        static void Main(string[] args)
        {
            // Auto-detect paths
            string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (Directory.Exists(Path.Combine(exeDir, "SERVER")))
                rootPath = exeDir;
            else
                rootPath = Directory.GetParent(exeDir).FullName;

            serverPath = Path.Combine(rootPath, "SERVER");

            if (!Directory.Exists(serverPath))
            {
                ShowError("SERVER folder not found at: " + serverPath);
                return;
            }

            bool serverRunning = IsPortInUse(6969);

            if (!serverRunning)
            {
                StartServer();
                // Wait for server to boot
                for (int i = 0; i < 20; i++)
                {
                    Thread.Sleep(500);
                    if (IsPortInUse(6969))
                        break;
                }
            }

            // Open browser
            Thread.Sleep(500);
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://localhost:6969",
                UseShellExecute = true
            });
        }

        static bool IsPortInUse(int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect("127.0.0.1", port, null, null);
                    bool connected = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(500));
                    if (connected)
                    {
                        client.EndConnect(result);
                        return true;
                    }
                    return false;
                }
            }
            catch
            {
                return false;
            }
        }

        static void StartServer()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c cd /d \"" + serverPath + "\" && npx tsx src/index.ts",
                    WorkingDirectory = serverPath,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                ShowError("Failed to start server: " + ex.Message);
            }
        }

        static void ShowError(string message)
        {
            Console.WriteLine("ERROR: " + message);
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
        }
    }
}
