// IronBend Support is an attended, temporary Windows helper.  It intentionally
// has no service, auto-start, file transfer, shell, clipboard, or unattended
// access capability.  The factory user sees and approves both sharing and
// control locally, and closing this visible window ends the session.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class NativeInput
{
    [DllImport("user32.dll")]
    internal static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    internal static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SupportForm(ReadBaseUrl(args)));
    }

    private static string ReadBaseUrl(string[] args)
    {
        for (var index = 0; index + 1 < args.Length; index += 1)
        {
            if (String.Equals(args[index], "--server", StringComparison.OrdinalIgnoreCase)) return args[index + 1].TrimEnd('/');
        }
        var configured = Environment.GetEnvironmentVariable("IRONBEND_SUPPORT_BASE_URL");
        return String.IsNullOrWhiteSpace(configured) ? "https://ironbend.onrender.com" : configured.TrimEnd('/');
    }
}

internal sealed class SupportForm : Form
{
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 5 * 1024 * 1024 };
    private readonly string baseUrl;
    private readonly TextBox codeInput = new TextBox();
    private readonly Button startButton = new Button();
    private readonly Button stopButton = new Button();
    private readonly Label status = new Label();
    private volatile bool stopRequested;
    private bool started;
    private bool askedForControl;
    private int sessionId;
    private int lastCommandId;
    private string agentToken;

    internal SupportForm(string supportBaseUrl)
    {
        baseUrl = supportBaseUrl;
        Text = "IronBend Support";
        Width = 530;
        Height = 340;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;
        Font = new Font("Segoe UI", 10F);

        var title = new Label { Text = "IronBend Support", AutoSize = true, Font = new Font("Segoe UI", 18F, FontStyle.Bold), Location = new Point(25, 24), RightToLeft = RightToLeft.No };
        var intro = new Label {
            Text = "תמיכה זמנית ומאושרת בלבד. הקלד את הקוד שמופיע במסך IronBend במפעל.",
            AutoSize = false, Width = 465, Height = 46, Location = new Point(25, 68), TextAlign = ContentAlignment.MiddleRight
        };
        var codeLabel = new Label { Text = "קוד תמיכה", AutoSize = true, Location = new Point(390, 126) };
        codeInput.Location = new Point(25, 149); codeInput.Width = 465; codeInput.MaxLength = 9; codeInput.TextAlign = HorizontalAlignment.Center; codeInput.Font = new Font("Consolas", 20F, FontStyle.Bold); codeInput.RightToLeft = RightToLeft.No;
        codeInput.TextChanged += delegate { NormalizeCode(); };
        startButton.Text = "התחל שיתוף מסך"; startButton.Location = new Point(25, 205); startButton.Width = 220; startButton.Height = 38; startButton.Click += delegate { StartSupport(); };
        stopButton.Text = "סיים תמיכה"; stopButton.Location = new Point(270, 205); stopButton.Width = 220; stopButton.Height = 38; stopButton.Enabled = false; stopButton.Click += delegate { Close(); };
        status.Text = "אין חיבור פעיל"; status.AutoSize = false; status.Width = 465; status.Height = 28; status.Location = new Point(25, 263); status.TextAlign = ContentAlignment.MiddleCenter; status.ForeColor = Color.FromArgb(84, 100, 120);
        Controls.Add(title); Controls.Add(intro); Controls.Add(codeLabel); Controls.Add(codeInput); Controls.Add(startButton); Controls.Add(stopButton); Controls.Add(status);
    }

    private void NormalizeCode()
    {
        var digits = Regex.Replace(codeInput.Text ?? String.Empty, "[^0-9]", String.Empty);
        if (digits.Length > 8) digits = digits.Substring(0, 8);
        var formatted = digits.Length > 4 ? digits.Substring(0, 4) + "-" + digits.Substring(4) : digits;
        if (codeInput.Text != formatted) { codeInput.Text = formatted; codeInput.SelectionStart = formatted.Length; }
    }

    private void StartSupport()
    {
        var code = (codeInput.Text ?? String.Empty).Trim();
        if (!Regex.IsMatch(code, "^\\d{4}-\\d{4}$")) { SetStatus("יש להקליד קוד בן 8 ספרות", Color.Firebrick); return; }
        try
        {
            SetStatus("מאמת קוד…", Color.FromArgb(84, 100, 120));
            var activated = Request("/api/remote-support/agent/activate", "POST", new Dictionary<string, object> { { "support_code", code } }, false);
            var session = Map(activated, "session");
            sessionId = Convert.ToInt32(session["id"]);
            agentToken = ValueText(activated, "agent_token");
            if (String.IsNullOrWhiteSpace(agentToken)) throw new InvalidOperationException("לא התקבל אישור חיבור.");

            var allowShare = MessageBox.Show(
                "האם לאפשר שיתוף מסך זמני עם מנהל IronBend?\nהפעולה מסתיימת בסגירת חלון זה או כאשר תוקף הסשן פג.",
                "IronBend Support — אישור שיתוף מסך", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (allowShare != DialogResult.Yes)
            {
                RequestAgent("/screen-consent", new Dictionary<string, object> { { "approved", false } });
                SetStatus("שיתוף המסך לא אושר", Color.Firebrick); return;
            }

            var bounds = Screen.PrimaryScreen.Bounds;
            RequestAgent("/ready", new Dictionary<string, object> { { "screen_width", bounds.Width }, { "screen_height", bounds.Height } });
            RequestAgent("/screen-consent", new Dictionary<string, object> { { "approved", true } });
            started = true; startButton.Enabled = false; codeInput.Enabled = false; stopButton.Enabled = true;
            SetStatus("שיתוף מסך פעיל. סגור חלון זה כדי לסיים.", Color.FromArgb(28, 116, 67));
            var worker = new Thread(RunSupport) { IsBackground = true, Name = "IronBend attended support" };
            worker.Start();
        }
        catch (Exception error) { SetStatus("לא ניתן להתחיל תמיכה: " + SafeMessage(error.Message), Color.Firebrick); }
    }

    private void RunSupport()
    {
        try
        {
            while (!stopRequested)
            {
                var state = Request("/api/remote-support/agent/" + sessionId + "/commands?after=" + lastCommandId, "GET", null, true);
                if (Bool(state, "session_ended")) break;
                if (Bool(state, "control_consent_required") && !askedForControl)
                {
                    askedForControl = true;
                    var approved = AskForControl();
                    RequestAgent("/control-consent", new Dictionary<string, object> { { "approved", approved } });
                    if (!approved) askedForControl = false;
                }
                var commands = state.ContainsKey("commands") ? state["commands"] as ArrayList : null;
                if (commands != null) foreach (var raw in commands) ApplyCommand(raw as Dictionary<string, object>);
                PostFrame();
                Thread.Sleep(850);
            }
            SetStatus("התמיכה הסתיימה", Color.FromArgb(84, 100, 120));
        }
        catch (Exception error) { SetStatus("התמיכה הסתיימה: " + SafeMessage(error.Message), Color.FromArgb(84, 100, 120)); }
        finally
        {
            try { if (started) RequestAgent("/end", new Dictionary<string, object> { { "reason", "factory_agent_closed" } }); } catch { }
            started = false;
        }
    }

    private bool AskForControl()
    {
        if (InvokeRequired) return (bool)Invoke(new Func<bool>(AskForControl));
        return MessageBox.Show(
            "מנהל IronBend מבקש שליטה בעכבר ובמקלדת. לאשר?\nניתן לסיים את התמיכה בכל רגע בסגירת החלון.",
            "IronBend Support — אישור שליטה", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes;
    }

    private void ApplyCommand(Dictionary<string, object> command)
    {
        if (command == null) return;
        var id = Number(command, "id"); if (id > lastCommandId) lastCommandId = id;
        var type = ValueText(command, "type");
        if (type == "pointer")
        {
            NativeInput.SetCursorPos(Number(command, "x"), Number(command, "y"));
            var action = ValueText(command, "action");
            if (action == "left_click") { NativeInput.mouse_event(2, 0, 0, 0, UIntPtr.Zero); NativeInput.mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
            if (action == "right_click") { NativeInput.mouse_event(8, 0, 0, 0, UIntPtr.Zero); NativeInput.mouse_event(16, 0, 0, 0, UIntPtr.Zero); }
        }
        else if (type == "key") { SendKeys.SendWait(ValueText(command, "sendKeys")); }
    }

    private void PostFrame()
    {
        var bounds = Screen.PrimaryScreen.Bounds;
        using (var source = new Bitmap(bounds.Width, bounds.Height))
        using (var sourceGraphics = Graphics.FromImage(source))
        {
            sourceGraphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            var scale = Math.Min(1.0, 1280.0 / Math.Max(1, bounds.Width));
            var width = Math.Max(1, (int)(bounds.Width * scale));
            var height = Math.Max(1, (int)(bounds.Height * scale));
            using (var preview = new Bitmap(width, height))
            using (var previewGraphics = Graphics.FromImage(preview))
            using (var stream = new MemoryStream())
            {
                previewGraphics.DrawImage(source, 0, 0, width, height);
                preview.Save(stream, ImageFormat.Jpeg);
                RequestAgent("/frame", new Dictionary<string, object> {
                    { "data", Convert.ToBase64String(stream.ToArray()) }, { "mime", "image/jpeg" },
                    { "width", bounds.Width }, { "height", bounds.Height }
                });
            }
        }
    }

    private Dictionary<string, object> RequestAgent(string path, Dictionary<string, object> body) { return Request("/api/remote-support/agent/" + sessionId + path, "POST", body, true); }

    private Dictionary<string, object> Request(string path, string method, Dictionary<string, object> body, bool agent) {
        var request = (HttpWebRequest)WebRequest.Create(baseUrl + path);
        request.Method = method; request.Timeout = 15000; request.ReadWriteTimeout = 15000; request.Accept = "application/json";
        if (agent) request.Headers["X-IronBend-Agent-Token"] = agentToken;
        if (method != "GET")
        {
            var payload = Encoding.UTF8.GetBytes(json.Serialize(body ?? new Dictionary<string, object>()));
            request.ContentType = "application/json"; request.ContentLength = payload.Length;
            using (var stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
        }
        try
        {
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) return json.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
        }
        catch (WebException error)
        {
            var message = error.Message;
            var response = error.Response as HttpWebResponse;
            if (response != null) using (var reader = new StreamReader(response.GetResponseStream())) message = reader.ReadToEnd();
            throw new InvalidOperationException(message);
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs eventArgs)
    {
        stopRequested = true;
        base.OnFormClosing(eventArgs);
    }

    private void SetStatus(string value, Color color) { if (InvokeRequired) { BeginInvoke(new Action<string, Color>(SetStatus), value, color); return; } status.Text = value; status.ForeColor = color; }
    private static string SafeMessage(string value) { return Regex.Replace(value ?? String.Empty, "[\\r\\n]+", " ").Trim(); }
    private static Dictionary<string, object> Map(Dictionary<string, object> parent, string key)
    {
        var value = parent[key] as Dictionary<string, object>;
        if (value == null) throw new InvalidOperationException("תגובה לא תקינה מהשרת.");
        return value;
    }
    private static string ValueText(Dictionary<string, object> values, string key) { return values.ContainsKey(key) && values[key] != null ? Convert.ToString(values[key]) : String.Empty; }
    private static int Number(Dictionary<string, object> values, string key) { try { return values.ContainsKey(key) ? Convert.ToInt32(values[key]) : 0; } catch { return 0; } }
    private static bool Bool(Dictionary<string, object> values, string key) { return values.ContainsKey(key) && values[key] is bool && (bool)values[key]; }
}
