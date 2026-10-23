🔒 Fix SQL injection in group relevance scoring savepoints

🎯 **What:** The vulnerability fixed
This commit fixes a potential SQL injection vulnerability in `store_relevance_scores` where the `SAVEPOINT` name was being inserted into queries via unparameterized f-strings.

⚠️ **Risk:** The potential impact if left unfixed
While the `savepoint` value is currently hardcoded and thus not immediately exploitable, if this function were ever updated to accept dynamic savepoint names from user input or external sources, an attacker could inject arbitrary SQL commands. This could lead to data exfiltration, manipulation, or denial of service by allowing the execution of unintended queries alongside or in place of the transaction control statements.

🛡️ **Solution:** How the fix addresses the vulnerability
Since SQLite (and SQL in general) does not support parameterization (`?`) for identifiers like savepoint names, the fix properly sanitizes the savepoint name by enclosing it in double quotes (`"`) and escaping any internal double quotes by doubling them (`""`). This ensures the identifier is treated purely as a name and not as executable SQL, eliminating the injection risk.
