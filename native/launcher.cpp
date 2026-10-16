// Chrome Native Messaging launcher. No shell; inherited binary stdin/stdout.
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <fstream>
#include <filesystem>
#include <string>
int wmain(int argc,wchar_t** argv) {
    wchar_t executable[32768];
    if(!GetModuleFileNameW(nullptr,executable,32768))return 1;
    auto folder=std::filesystem::path(executable).parent_path();
    std::ifstream input(folder / L"node-path.txt",std::ios::binary);
    std::string utf8((std::istreambuf_iterator<char>(input)),{});
    if(utf8.empty())return 2;
    int n=MultiByteToWideChar(CP_UTF8,0,utf8.data(),(int)utf8.size(),nullptr,0);
    std::wstring node(n,L'\0');MultiByteToWideChar(CP_UTF8,0,utf8.data(),(int)utf8.size(),node.data(),n);
    auto script=folder.parent_path() / L"src" / L"native-host.js";
    std::wstring origin=argc>1?argv[1]:L"";
    if(origin.find_first_of(L"\"\r\n")!=std::wstring::npos)return 3;
    std::wstring command=L"\""+node+L"\" \""+script.wstring()+L"\" \""+origin+L"\"";
    STARTUPINFOW si{};si.cb=sizeof(si);si.dwFlags=STARTF_USESTDHANDLES;
    si.hStdInput=GetStdHandle(STD_INPUT_HANDLE);si.hStdOutput=GetStdHandle(STD_OUTPUT_HANDLE);si.hStdError=GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION pi{};
    if(!CreateProcessW(node.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,folder.c_str(),&si,&pi))return 4;
    CloseHandle(pi.hThread);WaitForSingleObject(pi.hProcess,INFINITE);
    DWORD code=1;GetExitCodeProcess(pi.hProcess,&code);CloseHandle(pi.hProcess);return (int)code;
}
