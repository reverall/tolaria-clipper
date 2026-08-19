# Interpreter

The interpreter fills template fields with a language model instead of a page variable. It
is off by default and does nothing until you configure a provider.

Settings → Interpreter.

## What it does

Anywhere a template accepts a variable, you can write a prompt in double quotes:

```
{{"a one-sentence summary of this page"}}
{{"the three main claims, as a YAML list"}}
```

When you clip, the page content and every prompt in the template go to the model you
selected, in one request; the answers are substituted back into their places. Prompts work
in properties and in the note body alike.

The **Default prompt context** setting prepends the same instruction to every request —
useful for a house style ("answer in French, no preamble") without repeating it in each
prompt.

## Configuring a provider

1. **Settings → Interpreter → Enable interpreter.**
2. Add a provider. Twelve presets ship with the extension — Anthropic, OpenAI, Google
   Gemini, Azure OpenAI, DeepSeek, Hugging Face, Meta, Moonshot AI, Ollama, OpenRouter,
   Perplexity and xAI — each with its API key page and base URL prefilled. Anything else
   speaking an OpenAI-compatible `/chat/completions` endpoint works as a custom provider.
3. Paste an API key.
4. Add a model, and pick it as the interpreter model.

Keys are stored in the extension's synced storage, like the rest of your settings.

**Auto-run** sends the request as soon as the popup opens rather than waiting for you to
press the interpret button. Convenient, and it spends tokens on every clip whether you use
the result or not.

## Privacy

Requests go straight from your browser to the provider you chose. Nothing passes through
any server belonging to this extension or to Tolaria — there is no such server. Requests
carry an `HTTP-Referer` and `X-Title` header identifying the extension, which is what
OpenRouter uses for attribution.

Whatever the model sees is the page content the clipper extracted, so the provider's terms
and privacy policy apply to it.

## Running locally with Ollama

Ollama refuses requests coming from a browser extension until you allow the origin, and
answers `403` if you do not:

```
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
```

Restart Ollama afterwards. On Linux, set `OLLAMA_ORIGINS` in the service environment
instead. Then add Ollama as the provider with its default base URL, and register the model
name exactly as `ollama list` reports it.

## When it goes wrong

- **`403` from Ollama** — `OLLAMA_ORIGINS`, above.
- **Empty or truncated fields** — the model returned something that did not parse as the
  expected shape. Ask for the format explicitly ("as a YAML list of strings").
- **Nothing happens on clip** — check that the interpreter is enabled *and* that a model is
  selected as the interpreter model; the two are separate settings.
- **Slow clips** — the interpreter runs before the note is written. Turn auto-run off if you
  only want it occasionally.
