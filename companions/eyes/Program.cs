using System.IO;
// judith-eyes: Judith's native companion for Windows UI Automation.
//
// One job: say which controls are around a point of the screen, with their
// exact bounds. It keeps no state and decides nothing (choosing the control
// a mark means is done in src/core/snap.js, where it is tested).
//
// Protocol, one line in, one JSON line out (stdin/stdout, UTF-8):
//   around <id> <x> <y>   physical screen pixels
//     -> {"id":"<id>","elements":[{"name":"Exporter","type":"Button","x":..,"y":..,"w":..,"h":..},...]}
//   ping
//     -> {"id":"ping","ok":true}
// Errors: {"id":"<id>","error":"..."}.
//
// Targets .NET Framework 4.8, built into Windows 10 and 11: no runtime to
// install. Per-monitor DPI aware (app.manifest): coordinates are physical.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Windows;
using System.Windows.Automation;

internal static class Program
{
    private const int MaxAncestors = 6;
    private const int MaxChildren = 40;

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
            string[] parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) continue;
            string id = parts.Length > 1 ? parts[1] : "";
            try
            {
                if (parts[0] == "ping")
                {
                    Console.WriteLine("{\"id\":\"ping\",\"ok\":true}");
                }
                else if (parts[0] == "around" && parts.Length == 4)
                {
                    double x = double.Parse(parts[2], CultureInfo.InvariantCulture);
                    double y = double.Parse(parts[3], CultureInfo.InvariantCulture);
                    Console.WriteLine(Around(id, x, y));
                }
                else
                {
                    Console.WriteLine("{\"id\":" + Quote(id) + ",\"error\":\"unknown command\"}");
                }
            }
            catch (Exception error)
            {
                Console.WriteLine("{\"id\":" + Quote(id) + ",\"error\":" + Quote(error.Message) + "}");
            }
            Console.Out.Flush();
        }
    }

    // The control under the point, its parents (up to the window), and its
    // children: the mark may mean any of them.
    private static string Around(string id, double x, double y)
    {
        var elements = new List<AutomationElement>();
        AutomationElement hit = AutomationElement.FromPoint(new Point(x, y));
        if (hit != null)
        {
            TreeWalker walker = TreeWalker.ControlViewWalker;
            elements.Add(hit);
            AutomationElement parent = walker.GetParent(hit);
            for (int i = 0; parent != null && i < MaxAncestors && !parent.Equals(AutomationElement.RootElement); i++)
            {
                elements.Add(parent);
                parent = walker.GetParent(parent);
            }
            AutomationElement child = walker.GetFirstChild(hit);
            for (int i = 0; child != null && i < MaxChildren; i++)
            {
                elements.Add(child);
                child = walker.GetNextSibling(child);
            }
        }

        var json = new StringBuilder();
        json.Append("{\"id\":").Append(Quote(id)).Append(",\"elements\":[");
        bool first = true;
        foreach (AutomationElement element in elements)
        {
            Rect bounds;
            string name;
            string type;
            try
            {
                AutomationElement.AutomationElementInformation info = element.Current;
                bounds = info.BoundingRectangle;
                name = info.Name ?? "";
                type = info.ControlType != null ? info.ControlType.ProgrammaticName.Replace("ControlType.", "") : "";
            }
            catch (ElementNotAvailableException)
            {
                continue; // the control went away while we looked
            }
            if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0) continue;
            if (!first) json.Append(',');
            first = false;
            json.Append("{\"name\":").Append(Quote(name))
                .Append(",\"type\":").Append(Quote(type))
                .Append(",\"x\":").Append(Number(bounds.X))
                .Append(",\"y\":").Append(Number(bounds.Y))
                .Append(",\"w\":").Append(Number(bounds.Width))
                .Append(",\"h\":").Append(Number(bounds.Height))
                .Append('}');
        }
        json.Append("]}");
        return json.ToString();
    }

    private static string Number(double value)
    {
        return Math.Round(value).ToString(CultureInfo.InvariantCulture);
    }

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
}
