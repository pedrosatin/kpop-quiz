🔒 Fix SQL injection vulnerability in SAVEPOINT

🎯 **What:**
Fixed a SQL injection vulnerability in `kpop_scraping/group_relevance_scoring.py` caused by directly inserting a variable into a `SAVEPOINT` query using an f-string (`f"SAVEPOINT {savepoint}"`).

⚠️ **Risk:**
Although the current savepoint name is hardcoded (`"group_relevance_score"`), this is a bad security practice. If the name were to become dynamic or derived from user input in the future, it could allow an attacker to inject arbitrary SQL commands. SQLite `SAVEPOINT` identifiers cannot be parameterized using standard `?` syntax.

🛡️ **Solution:**
Since SQLite cannot use `?` for `SAVEPOINT` identifiers, the savepoint name must be properly quoted and escaped. I updated the code to wrap the identifier in double quotes (`"`) and escape any internal double quotes by doubling them (`""`), ensuring it is always parsed securely as an identifier by SQLite.

Tests have been run and verified.
