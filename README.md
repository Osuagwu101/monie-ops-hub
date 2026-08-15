# Moniepoint Ops Hub

Create a minimal, clean starter dashboard for a "Moniepoint BRM Operations Portal".

Keep it lightweight and simple:

- Layout: Top header with "Moniepoint Operations" branding (Moniepoint blue #0357EE theme) and a collapsible sidebar (Overview, Daily Tasks, Merchant List, AI Logs).

- Overview Page:

  - 3 simple stat cards (Active Terminals, Daily Volume Target, Pending Tasks).

  - A spreadsheet-style table for "Today's Tasks" with columns: Merchant Name, Phone Number, Terminal ID (TID), Task Type (TA / Loan), Human Notes, Status (Pending / Verified).

  - A simple popup/modal with a text box for the assistant to submit their daily work notes.

Use Tailwind CSS, Lucide React icons, and a single mock data file. Keep the code simple, clean, and ready to push to GitHub.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://monie-ops-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7ac512d0-c766-430b-8627-d8ffed83decd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
