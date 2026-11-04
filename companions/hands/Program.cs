using System.IO;
// judith-hands: Judith's hands for agent mode (autonomous), through SendInput.
//
// It executes and decides nothing: each action was checked by
// src/core/guard.js (and confirmed by the user when needed) before it gets here.
// One safety lives here, because only here is it reliable: if the mouse is not
// where Judith left it, the user moved it, and every action is refused
// ("user") until Judith starts a new session ("reset"). Moving the mouse takes
// the hand back.
//
// Protocol, one line in, one JSON line out (stdin/stdout, UTF-8). Coordinates
// are physical screen pixels (per-monitor DPI aware, see app.manifest):
//   at <id> <x> <y>                 the app of the window under the point
//   fg <id>                         the app in the foreground (where keys go)
//     -> {"id":"..","process":"chrome","title":"..."}
//   click <id> <x> <y> <left|right|double>
//   type <id> <base64 of UTF-8 text>
//   key <id> <combo>                e.g. enter, ctrl+s, shift+tab
//   scroll <id> <x> <y> <notches>   negative: down
//   reset <id>                      a new session: the mouse is the user's again
//   ping
//     -> {"id":"..","ok":true}
// Errors: {"id":"..","error":"..."}; "user" means the user moved the mouse.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    private static bool hasLast;
    private static int lastX;
    private static int lastY;
    private static bool stopped;

    [STAThread]
    private static void Main()
    {
        // No console window (WinExe): setting Console.InputEncoding would throw
        // "invalid handle". Open the piped streams in UTF-8 instead.
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            string[] p = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (p.Length == 0) continue;
            string id = p.Length > 1 ? p[1] : "";
            string reply;
            try
            {
                reply = Run(p, id);
            }
            catch (Exception error)
            {
                reply = "{\"id\":" + Quote(id) + ",\"error\":" + Quote(error.Message) + "}";
            }
            Console.WriteLine(reply);
            Console.Out.Flush();
        }
    }

    private static string Ok(string id)
    {
        return "{\"id\":" + Quote(id) + ",\"ok\":true}";
    }

    private static string Run(string[] p, string id)
    {
        switch (p[0])
        {
            case "ping":
                return Ok(id);
            case "reset":
                stopped = false;
                hasLast = false;
                return Ok(id);
            case "at":
                return Describe(id, WindowFromPoint(new POINT { X = Int(p[2]), Y = Int(p[3]) }));
            case "fg":
                return Describe(id, GetForegroundWindow());
        }
        // Every action: refused once the user took the mouse back.
        if (stopped || UserMoved())
        {
            stopped = true;
            return "{\"id\":" + Quote(id) + ",\"error\":\"user\"}";
        }
        switch (p[0])
        {
            case "click":
                Click(Int(p[2]), Int(p[3]), p.Length > 4 ? p[4] : "left");
                break;
            case "type":
                TypeText(Encoding.UTF8.GetString(Convert.FromBase64String(p[2])));
                break;
            case "key":
                Key(p[2]);
                break;
            case "scroll":
                Scroll(Int(p[2]), Int(p[3]), Int(p[4]));
                break;
            default:
                throw new Exception("unknown command");
        }
        Remember();
        return Ok(id);
    }

    private static int Int(string s)
    {
        return (int)Math.Round(double.Parse(s, CultureInfo.InvariantCulture));
    }

    // ----- the user's mouse -----
    private static bool UserMoved()
    {
        if (!hasLast) return false;
        POINT now;
        GetCursorPos(out now);
        return Math.Abs(now.X - lastX) > 4 || Math.Abs(now.Y - lastY) > 4;
    }

    private static void Remember()
    {
        POINT now;
        GetCursorPos(out now);
        lastX = now.X;
        lastY = now.Y;
        hasLast = true;
    }

    // ----- what is under a point -----
    private static string Describe(string id, IntPtr hwnd)
    {
        IntPtr root = hwnd == IntPtr.Zero ? IntPtr.Zero : GetAncestor(hwnd, 2 /* GA_ROOT */);
        if (root == IntPtr.Zero) return "{\"id\":" + Quote(id) + ",\"process\":\"\",\"title\":\"\"}";
        uint pid;
        GetWindowThreadProcessId(root, out pid);
        string process = "";
        try { process = Process.GetProcessById((int)pid).ProcessName; } catch (ArgumentException) { }
        var title = new StringBuilder(512);
        GetWindowText(root, title, title.Capacity);
        return "{\"id\":" + Quote(id) + ",\"process\":" + Quote(process) + ",\"title\":" + Quote(title.ToString()) + "}";
    }

    // ----- mouse -----
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;

    private static void MoveTo(int x, int y)
    {
        SetCursorPos(x, y);
        Thread.Sleep(40);
    }

    private static void Click(int x, int y, string button)
    {
        MoveTo(x, y);
        bool right = button == "right";
        int times = button == "double" ? 2 : 1;
        for (int i = 0; i < times; i++)
        {
            Send(Mouse(right ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN, 0), Mouse(right ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP, 0));
            if (times > 1) Thread.Sleep(60);
        }
    }

    private static void Scroll(int x, int y, int notches)
    {
        MoveTo(x, y);
        Send(Mouse(MOUSEEVENTF_WHEEL, notches * 120));
    }

    private static INPUT Mouse(uint flags, int data)
    {
        var input = new INPUT { type = 0 };
        input.u.mi = new MOUSEINPUT { dwFlags = flags, mouseData = unchecked((uint)data) };
        return input;
    }

    // ----- keyboard -----
    private const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;

    private static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort>
    {
        { "enter", 0x0D }, { "tab", 0x09 }, { "escape", 0x1B }, { "esc", 0x1B }, { "space", 0x20 },
        { "backspace", 0x08 }, { "delete", 0x2E }, { "del", 0x2E },
        { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
        { "home", 0x24 }, { "end", 0x23 }, { "pageup", 0x21 }, { "pagedown", 0x22 },
        { "f2", 0x71 }, { "f5", 0x74 },
        { "ctrl", 0x11 }, { "shift", 0x10 }, { "alt", 0x12 },
    };

    private static ushort Vk(string name)
    {
        ushort vk;
        if (Keys.TryGetValue(name, out vk)) return vk;
        if (name.Length == 1 && char.IsLetterOrDigit(name[0])) return (ushort)char.ToUpperInvariant(name[0]);
        throw new Exception("unknown key " + name);
    }

    private static void Key(string combo)
    {
        string[] names = combo.ToLowerInvariant().Split('+');
        var codes = new List<ushort>();
        foreach (string name in names) codes.Add(Vk(name));
        var inputs = new List<INPUT>();
        foreach (ushort vk in codes) inputs.Add(Keyboard(vk, '\0', 0));
        for (int i = codes.Count - 1; i >= 0; i--) inputs.Add(Keyboard(codes[i], '\0', KEYEVENTF_KEYUP));
        Send(inputs.ToArray());
    }

    private static void TypeText(string text)
    {
        foreach (char c in text)
        {
            if (c == '\r') continue;
            if (c == '\n')
            {
                Send(Keyboard(0x0D, '\0', 0), Keyboard(0x0D, '\0', KEYEVENTF_KEYUP));
                continue;
            }
            Send(Keyboard(0, c, KEYEVENTF_UNICODE), Keyboard(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
            Thread.Sleep(8);
        }
    }

    private static INPUT Keyboard(ushort vk, char scan, uint flags)
    {
        var input = new INPUT { type = 1 };
        input.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
        return input;
    }

    private static void Send(params INPUT[] inputs)
    {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
            throw new Exception("SendInput refused (the target may run as administrator)");
    }

    // ----- JSON -----
    private static string Quote(string text)
    {
        var json = new StringBuilder("\"");
        foreach (char c in text ?? "")
        {
            switch (c)
            {
                case '"': json.Append("\\\""); break;
                case '\\': json.Append("\\\\"); break;
                case '\n': json.Append("\\n"); break;
                case '\r': json.Append("\\r"); break;
                case '\t': json.Append("\\t"); break;
                default:
                    if (c < 0x20) json.Append("\\u").Append(((int)c).ToString("x4"));
                    else json.Append(c);
                    break;
            }
        }
        return json.Append('"').ToString();
    }

    // ----- Win32 -----
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
}
