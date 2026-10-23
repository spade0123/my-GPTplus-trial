using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class CoachWindow : Form {
    readonly WebView2 view = new WebView2();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 12000000 };
    readonly StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
    readonly string root, profile;
    string pendingHtml, pendingTitle, allowedNavigation;
    bool ready, exiting;
    public CoachWindow(string rootPath, string profilePath) {
        root = Path.GetFullPath(rootPath); profile = Path.GetFullPath(profilePath);
        Text = "OpenJudge C++ 学习教练"; StartPosition = FormStartPosition.Manual;
        var area = Screen.PrimaryScreen.WorkingArea;
        Size = new Size(Math.Min(660, area.Width-80), Math.Min(920, area.Height-70));
        Location = new Point(area.Right-Width-18, area.Top+24); MinimumSize = new Size(400, 420);
        TopMost = true; ShowInTaskbar = true; BackColor = Color.FromArgb(30,30,30);
        view.Dock = DockStyle.Fill; Controls.Add(view);
        view.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = profile, ProfileName = "OpenJudgeCoach", IsInPrivateModeEnabled = true };
        FormClosing += delegate(object sender, FormClosingEventArgs e) {
            if(exiting) return; e.Cancel = true; Send(new { type="native_close_requested" });
        };
        Shown += async delegate { Hide(); await Initialize(); };
        var inputThread = new Thread(ReadInput) { IsBackground=true }; inputThread.Start();
    }
    void Send(object value) { lock(output) { try { output.WriteLine(json.Serialize(value)); } catch { } } }
    async Task Initialize() {
        try {
            await view.EnsureCoreWebView2Async();
            var core = view.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled=false; core.Settings.AreDevToolsEnabled=false;
            core.Settings.IsStatusBarEnabled=false; core.Settings.AreDefaultScriptDialogsEnabled=false;
            core.Settings.IsGeneralAutofillEnabled=false; core.Settings.IsPasswordAutosaveEnabled=false;
            core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled=true; };
            core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State=CoreWebView2PermissionState.Deny; };
            core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) { e.Cancel=true; };
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if(e.Uri!="about:blank" && e.Uri!=allowedNavigation) e.Cancel=true; };
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
                try {
                Uri u; if(!Uri.TryCreate(e.Request.Uri,UriKind.Absolute,out u) || u.Scheme!="https" || u.Host!="coach.local")
                    e.Response=core.Environment.CreateWebResourceResponse(new MemoryStream(),403,"Blocked","");
                else if(u.AbsolutePath=="/__window")
                    e.Response=core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(pendingHtml??"<!doctype html>")),200,"OK","Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
                else {
                    string relative=Uri.UnescapeDataString(u.AbsolutePath).TrimStart('/').Replace('/',Path.DirectorySeparatorChar);
                    string file=Path.GetFullPath(Path.Combine(root,relative)),extension=Path.GetExtension(file).ToLowerInvariant();
                    string mime=extension==".js"?"text/javascript":extension==".css"?"text/css":extension==".woff2"?"font/woff2":extension==".woff"?"font/woff":extension==".ttf"?"font/ttf":extension==".svg"?"image/svg+xml":extension==".png"?"image/png":"";
                    if(file.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase) && mime!="" && File.Exists(file))
                        e.Response=core.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)),200,"OK","Content-Type: "+mime);
                    else e.Response=core.Environment.CreateWebResourceResponse(new MemoryStream(),404,"Not found","");
                }
                } catch { e.Response=core.Environment.CreateWebResourceResponse(new MemoryStream(),400,"Invalid resource",""); }
            };
            core.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) { lock(output) { output.WriteLine(e.WebMessageAsJson); } };
            ready=true; Send(new { type="native_ready" });
            if(pendingHtml!=null) LoadHtml(pendingHtml,pendingTitle);
        } catch(Exception error) { Send(new {type="native_error",error="浮窗启动失败："+error.Message}); exiting=true; Close(); }
    }
    void LoadHtml(string html,string title) {
        pendingHtml=html; pendingTitle=title;
        if(!ready) return;
        Text=title; allowedNavigation="https://coach.local/__window?view="+Guid.NewGuid().ToString("N");
        view.CoreWebView2.Navigate(allowedNavigation); Show(); Activate();
    }
    void ReadInput() {
        try {
            var input=new StreamReader(Console.OpenStandardInput(),Encoding.UTF8);
            var inputJson=new JavaScriptSerializer { MaxJsonLength=12000000 };
            string line;
            while((line=input.ReadLine())!=null) {
                var value=inputJson.Deserialize<Dictionary<string,object>>(line);
                // Wait for the UI handle before dispatching the first command.
                while(!IsHandleCreated && !IsDisposed) Thread.Sleep(10);
                if(IsDisposed) return;
                BeginInvoke((Action)delegate { Dispatch(value); });
            }
        } catch(Exception error) { Send(new {type="native_error",error=error.Message}); }
        try { BeginInvoke((Action)delegate { exiting=true; Close(); }); } catch { }
    }
    void Dispatch(Dictionary<string,object> v) {
        try {
            string command=(string)v["cmd"];
            if(command=="html") LoadHtml((string)v["html"],(string)v["title"]);
            else if(command=="post" && ready) view.CoreWebView2.PostWebMessageAsJson((string)v["json"]);
            else if(command=="focus") { Show(); Activate(); }
            else if(command=="hide") { Hide(); pendingHtml=null; if(ready)view.CoreWebView2.Navigate("about:blank"); }
            else if(command=="close") { exiting=true; Close(); }
        } catch(Exception error) { Send(new {type="native_error",error=error.Message}); }
    }
    [STAThread] static void Main(string[] args) {
        if(args.Length!=2) return;
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using(var window=new CoachWindow(args[0],args[1])) Application.Run(window);
    }
}
