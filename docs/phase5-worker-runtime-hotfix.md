# Phase 5 worker runtime hotfix

The first post-publish negative-security probe exposed an eager server PDF-module import that caused the automation API route to fail during module startup before it could return the expected unauthorized response.

The worker now lazy-loads the server PDF adapter only after an authenticated Browser Use task has finished and an official PDF has actually been downloaded. This keeps the public request/authentication path independent of PDF runtime dependencies while preserving the same shared Phase 3 parser for authenticated report completion.
