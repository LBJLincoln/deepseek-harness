---
name: injection
description: SQL, NoSQL, command, template/eval, and code injection; XSS DOM sinks and unescaped templates; path traversal; SSRF; and unsafe deserialization — the code smell and the safe alternative per framework, with CWE ids for each.
---

# Injection and its sinks

Every entry here is data reaching an interpreter without a boundary between the two. The fix is always a boundary the interpreter itself enforces (a parameter, an argument array, an auto-escaping context), never a blocklist or a manual escape function.

## SQL and NoSQL (CWE-89, CWE-943)

Recognize string-built queries: JS template literals into `db.query(\`SELECT * FROM users WHERE id=${id}\`)`, Python f-strings into `cursor.execute(f"... {name}")` or Django `.raw()`/`.extra()`, Java string concatenation into a `Statement` (not `PreparedStatement`), Go `fmt.Sprintf` into `db.Query`, PHP `DB::raw()`/`whereRaw()` in Laravel or `$pdo->query($sql . $_GET['x'])`. For MongoDB, look for `$where` with a JS string built from input, and for an entire operator object passed through from the request body (`User.find(req.body.filter)`), which lets an attacker inject `$ne`, `$gt`, or `$regex` operators. Fix: parameterized queries or prepared statements everywhere (`db.query('... WHERE id=?', [id])`, Django ORM/`.filter()`, JPA/Hibernate named parameters, `$1` placeholders in Go's `database/sql`, Eloquent query builder); for Mongo, whitelist the filter's keys and reject any key starting with `$` in user-supplied filter objects.

## Command injection (CWE-78, CWE-77)

Recognize Node `child_process.exec(\`cmd ${input}\`)` or `execSync`, Python `os.system(f"...")` or `subprocess.run(cmd, shell=True)`, PHP `shell_exec`/`system`/backticks, Java `Runtime.exec("sh -c " + input)`. Fix: an argument-array API with no shell — `execFile(cmd, [arg1, arg2])`, `subprocess.run([cmd, arg], shell=False)` — or avoid a subprocess entirely for what a library call can do.

## Template injection and `eval` (CWE-94, CWE-1336)

Recognize `eval()`, `new Function(input)`, PHP `eval()`/`create_function()`, and a template engine given the template string itself from user input (`Handlebars.compile(userInput)`, Jinja2 `Template(user_input)`, Twig `render string` with request data as the template rather than a variable). Fix: never treat request data as code or as a template body; render fixed templates with request data only as variables, and drop `eval`/dynamic template compilation from the request path entirely.

## XSS (CWE-79)

Recognize DOM sinks fed by request or URL data: `innerHTML`, `document.write`, `location.href` built from `location.hash`; React `dangerouslySetInnerHTML={{__html: data}}` on unsanitized data; a template engine's raw/unescaped output helper (EJS `<%- %>`, Django `{% autoescape off %}` or `|safe`, Jinja2 `|safe`); Next.js `dangerouslySetInnerHTML` in a server component fed unsanitized markdown. Fix: keep auto-escaping on and use it for all request-derived output; when raw HTML is genuinely required (rendered markdown, rich text), sanitize with an allowlist library (DOMPurify, `bleach`) immediately before the raw sink, not earlier in the pipeline where a later transform could reintroduce risk.

## Path traversal (CWE-22)

Recognize a filename, path segment, or archive-entry name from the request concatenated into a filesystem path: `fs.readFile(path.join(base, req.params.file))` without resolution, Python `open(os.path.join(base, filename))`, Java `new File(base, request.getParameter("f"))`, PHP `file_get_contents($base . $_GET['file'])`, and zip/tar extraction that trusts an entry's path (zip-slip). Fix: resolve to an absolute path and verify it is still inside the base directory (`path.resolve` plus a prefix check, `os.path.realpath` plus `os.path.commonpath`) before any filesystem call; reject `..` and absolute paths in archive entry names during extraction.

## SSRF (CWE-918)

Recognize a server-side HTTP client (`axios`, `fetch`, `requests`, Java `RestTemplate`/`HttpClient`, Go `net/http`, PHP `file_get_contents`/`curl`) called with a URL or host taken from the request, especially in webhooks, URL-preview, and PDF/image-fetch features. Fix: an allowlist of destination hosts, a block on private/link-local/metadata-service ranges (`169.254.169.254`, RFC 1918), and re-resolving and re-checking the IP after DNS resolution to close TOCTOU/DNS-rebind gaps.

## Unsafe deserialization (CWE-502)

Recognize Python `pickle.loads`/`yaml.load` (without `Loader=SafeLoader`) on request or cookie bytes, Java `ObjectInputStream.readObject` on request data, PHP `unserialize()` on user input, and Node's `node-serialize`/`eval`-based deserializers. Fix: a data-only format (JSON) with schema validation, or a restricted/safe deserializer that cannot instantiate arbitrary classes.

## Safe defaults by framework

Express/Next.js: parameterized DB clients, `execFile`, DOMPurify, `path.resolve` + prefix check. Django/Flask/FastAPI: ORM querysets, `subprocess.run(shell=False)`, autoescaping Jinja2, Pydantic validation. Spring: JPA/`PreparedStatement`, `ProcessBuilder` with an argument list, Thymeleaf autoescaping, Bean Validation. Laravel/Symfony: Eloquent/Doctrine, `Symfony\Component\Process\Process` with an argument array, Blade/Twig autoescaping.
