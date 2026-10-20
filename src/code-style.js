// One generation rule for hint snippets and complete reference answers.
// Rendering/copying and the student's captured source stay byte-for-byte intact.
export const CPP_EXAMPLE_STYLE=`新写或建议的 C++ 代码统一采用以下格式，适用于行内示例、局部片段和完整参考程序：
不加任何 // 或 /* */ 注释，解释写在代码块外。运算符及标点旁不加多余空格，例如 cnt+1、cin>>n、i<n、for(int i=0;i<n;i++)；保留缩进、换行，以及 int n、long long、using namespace std; 等必要空格。
保留字符串、字符字面量、原始字符串和预处理指令中有意义的空格，不为压缩空格改变代码含义；会合并成另一运算符的地方保留必要分隔或使用括号。引用用户已有源码或报错原文时保留原文，不能把排版差异说成逻辑错误。
局部修改仍只给必要片段；多行片段放入 cpp 代码块，供界面统一高亮和复制。确需完整程序时包含 using namespace std;，避免反复添加 std:: 前缀。`;
