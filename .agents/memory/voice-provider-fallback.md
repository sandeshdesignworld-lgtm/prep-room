---
name: Voice provider fallback
description: The avatar's speech path and the required fallback behavior when a TTS provider is unavailable.
---

AvatarKit direct mode needs a streamed mono 16-bit PCM voice feed at 24 kHz. Server TTS should expose one provider-neutral endpoint that returns PCM for the avatar and MP3 for ordinary audio playback.

**Why:** Sarvam can be configured correctly but still return a quota error; treating it as the only voice provider makes the avatar silently stop speaking even though another configured provider can produce compatible audio.

**How to apply:** Prefer an available server TTS provider, retry another provider after an upstream failure, and keep browser speech synthesis as the final fallback. Never expose provider keys to the client.