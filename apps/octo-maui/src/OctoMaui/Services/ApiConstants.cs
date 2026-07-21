namespace OctoMaui.Services;

internal static class ApiPaths
{
    public const string Prefix = "/v1";

    public const string CommonAppconfig = $"{Prefix}/common/appconfig";

    public const string UserLogin = $"{Prefix}/user/login";
    public const string UserEmailLogin = $"{Prefix}/user/emaillogin";
    public const string UserUsernameRegister = $"{Prefix}/user/usernameregister";
    public const string UserEmailSendCode = $"{Prefix}/user/email/sendcode";
    public const string UserEmailRegister = $"{Prefix}/user/emailregister";
    public const string UserEmailForgetPwd = $"{Prefix}/user/email/forgetpwd";
    public const string UserCurrent = $"{Prefix}/user/current";

    public const string UserLoginUuid = $"{Prefix}/user/loginuuid";
    public const string UserLoginStatus = $"{Prefix}/user/loginstatus";
    public const string UserLoginAuthcode = $"{Prefix}/user/login_authcode";

    public const string UserThirdLoginAuthcode = $"{Prefix}/user/thirdlogin/authcode";
    public const string UserThirdLoginAuthstatus = $"{Prefix}/user/thirdlogin/authstatus";

    public const string UsersIm = $"{Prefix}/users";

    public const string FileUploadCredentials = $"{Prefix}/file/upload/credentials";

    public const string MessageSend = $"{Prefix}/message/send";

    public const string VersionJson = "/version.json";
}

internal static class ApiDefaults
{
    public const string BaseUrl = "https://localhost:8080";

    public const int DeviceFlagPc = 2;
    public const int DeviceFlagWeb = 1;
    public const int DeviceFlagApp = 0;
}

internal static class PreferencesKeys
{
    public const string Token = "octo.auth.token";
    public const string ServerUrl = "octo_server_url";
    public const string WinX = "win.x";
    public const string WinY = "win.y";
    public const string WinW = "win.w";
    public const string WinH = "win.h";
    public const string AuthUid = "octo.auth.uid";
    public const string AuthName = "octo.auth.name";
    public const string AuthSex = "octo.auth.sex";
    public const string AuthShortNo = "octo.auth.short_no";
}