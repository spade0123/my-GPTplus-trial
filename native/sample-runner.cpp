#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0602
#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <algorithm>
using namespace std;

struct Handle{
    HANDLE value;
    explicit Handle(HANDLE h=nullptr):value(h){}
    ~Handle(){if(value&&value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Handle(const Handle&)=delete;
    Handle& operator=(const Handle&)=delete;
};
static int report(const wchar_t* file,bool ran,DWORD error,DWORD exitCode,ULONGLONG elapsed,SIZE_T peak,const char* reason){
    FILE* out=_wfopen(file,L"wb");if(!out)return 121;
    fprintf(out,"{\"ranProgram\":%s,\"errorCode\":%lu,\"exitCode\":%lu,\"durationMs\":%llu,\"peakMemoryBytes\":%llu,\"reason\":",ran?"true":"false",static_cast<unsigned long>(error),static_cast<unsigned long>(exitCode),static_cast<unsigned long long>(elapsed),static_cast<unsigned long long>(peak));
    if(reason)fprintf(out,"\"%s\"",reason);else fprintf(out,"null");
    fprintf(out,"}");fclose(out);return 0;
}
static HANDLE duplicateStd(DWORD which){
    HANDLE result=nullptr;
    DuplicateHandle(GetCurrentProcess(),GetStdHandle(which),GetCurrentProcess(),&result,0,TRUE,DUPLICATE_SAME_ACCESS);
    return result;
}
int wmain(int argc,wchar_t** argv){
    if(argc!=5)return 120;
    const ULONGLONG timeout=_wcstoui64(argv[2],nullptr,10),memory=_wcstoui64(argv[3],nullptr,10);
    if(timeout<20||timeout>60000||memory<16ULL*1024*1024||memory>2048ULL*1024*1024)return 120;
    SetErrorMode(SEM_NOGPFAULTERRORBOX|SEM_FAILCRITICALERRORS);
    Handle job(CreateJobObjectW(nullptr,nullptr)),port(CreateIoCompletionPort(INVALID_HANDLE_VALUE,nullptr,0,1));
    if(!job.value||!port.value)return report(argv[4],false,GetLastError(),0,0,0,"runner_error");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_JOB_MEMORY;
    limits.JobMemoryLimit=static_cast<SIZE_T>(memory);
    JOBOBJECT_ASSOCIATE_COMPLETION_PORT association{job.value,port.value};
    JOBOBJECT_NOTIFICATION_LIMIT_INFORMATION notice{};notice.LimitFlags=JOB_OBJECT_LIMIT_JOB_MEMORY;notice.JobMemoryLimit=memory-1;
    if(!SetInformationJobObject(job.value,JobObjectExtendedLimitInformation,&limits,sizeof(limits))||!SetInformationJobObject(job.value,JobObjectAssociateCompletionPortInformation,&association,sizeof(association))||!SetInformationJobObject(job.value,JobObjectNotificationLimitInformation,&notice,sizeof(notice)))return report(argv[4],false,GetLastError(),0,0,0,"runner_error");
    Handle input(duplicateStd(STD_INPUT_HANDLE)),output(duplicateStd(STD_OUTPUT_HANDLE)),error(duplicateStd(STD_ERROR_HANDLE));
    if(!input.value||!output.value||!error.value)return report(argv[4],false,GetLastError(),0,0,0,"runner_error");
    STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESTDHANDLES;startup.hStdInput=input.value;startup.hStdOutput=output.value;startup.hStdError=error.value;
    PROCESS_INFORMATION process{};wstring command=L"\""+wstring(argv[1])+L"\"";
    if(!CreateProcessW(argv[1],command.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW|CREATE_SUSPENDED,nullptr,nullptr,&startup,&process))return report(argv[4],false,GetLastError(),0,0,0,"runner_error");
    Handle child(process.hProcess),thread(process.hThread);
    if(!AssignProcessToJobObject(job.value,child.value)){
        const DWORD code=GetLastError();TerminateProcess(child.value,125);WaitForSingleObject(child.value,1000);return report(argv[4],false,code,0,0,0,"runner_error");
    }
    const ULONGLONG start=GetTickCount64();
    if(ResumeThread(thread.value)==static_cast<DWORD>(-1))return report(argv[4],false,GetLastError(),0,0,0,"runner_error");
    const char* reason=nullptr;
    auto notification=[&](DWORD wait){
        DWORD message=0;ULONG_PTR key=0;LPOVERLAPPED processId=nullptr;
        if(!GetQueuedCompletionStatus(port.value,&message,&key,&processId,wait))return false;
        if(!reason&&(message==JOB_OBJECT_MSG_JOB_MEMORY_LIMIT||message==JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT||message==JOB_OBJECT_MSG_NOTIFICATION_LIMIT)){reason="memory_limit";TerminateJobObject(job.value,126);}
        return true;
    };
    for(;;){
        notification(5);
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
        if(!QueryInformationJobObject(job.value,JobObjectBasicAccountingInformation,&accounting,sizeof(accounting),nullptr)){reason="runner_error";TerminateJobObject(job.value,125);break;}
        if(accounting.ActiveProcesses==0)break;
        if(!reason&&GetTickCount64()-start>=timeout){reason="timeout";TerminateJobObject(job.value,124);}
    }
    // Drain notifications even when an allocation failure made the process exit immediately.
    while(notification(20)){}
    WaitForSingleObject(child.value,1000);DWORD exitCode=0;GetExitCodeProcess(child.value,&exitCode);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION usage{};
    const bool measured=QueryInformationJobObject(job.value,JobObjectExtendedLimitInformation,&usage,sizeof(usage),nullptr)!=FALSE;
    const SIZE_T peak=measured?max(usage.PeakJobMemoryUsed,usage.PeakProcessMemoryUsed):0;
    if(!reason&&measured&&peak>=memory)reason="memory_limit";
    return report(argv[4],true,0,exitCode,GetTickCount64()-start,peak,reason);
}
