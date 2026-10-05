# Getting started with an AI co-pilot

The fun way to remix the Gondryator is with an AI assistant that can run code. Paste it this:

> Help me make my own Gondryator: https://github.com/FrunkQ/gondryator. Read AGENTS.md, get the generated demo running, and suggest a few remixes based on something I love. Handle the technical setup for me.

A good co-pilot will pitch ideas, install everything, start the app and show you the demo song playing, then build the remix you pick and tell you exactly where to look.

## What you need

- **Node.js 22 or newer** ([nodejs.org](https://nodejs.org), the LTS download). Node 24 works too.
- **git**, to get the code: `git clone https://github.com/FrunkQ/gondryator`.
- **A recent browser**: Chrome, Edge, Firefox or Safari. WebGPU is used where it exists, WebGL2 everywhere else.

Then, in the folder:

```
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173) and add `?demo` to hear the generated demo song, or drop in any song of your own. Nothing is uploaded: your music stays on your machine.

To check everything at once: `npm run smoke`. It checks Node, builds, and plays the demo in a hidden browser on the train and in the non-Gondry view. The hidden browser needs a one-off `npx playwright-core install chromium`, or `CHROME=/path/to/chrome npm run smoke` to use the Chrome you already have.

## If your assistant can read code but can't run it

Some assistants (a chat window, or a GitHub connection on its own) can read and write the code but can't run commands or open a browser. That still works, it just needs your hands:

1. Ask it for the exact commands, one at a time, and paste them into a terminal on your computer (Terminal on a Mac, PowerShell on Windows).
2. Tell it what you see: copy any error message in full, or describe what is on screen.
3. When it changes a file, ask it for the whole file (or the exact lines) and where it goes. With `npm run dev` running, the page reloads by itself when you save.

Or switch to an assistant with a terminal (a coding agent in your editor or on the command line) and let it do all of the above itself.

## When something goes wrong

- **"npm: command not found" or a Vite error about the Node version:** install Node 22 or newer, then run `npm install` again. `nvm use` picks the right version if you have nvm.
- **The page stays black:** try Chrome or Edge, and check hardware acceleration is on in the browser's settings.
- **A port or permission error from a sandboxed assistant:** that is the assistant's environment, not the project. Approve the prompt, or run the command yourself.
- **`npm run smoke` exits with code 2:** something is missing on the machine (it says what). Code 1 means the project itself hit an error: share the output with your co-pilot.
