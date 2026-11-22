# Installing 3DPrintCollectors

3DPrintCollectors runs on your own computer and you use it in your web browser. Nothing is uploaded
anywhere: the app and all of your data live in one folder on your computer.

- [What you need](#what-you-need)
- [Install on a Mac](#install-on-a-mac)
- [Install on Windows](#install-on-windows)
- [First start](#first-start)
- [Where your data is stored](#where-your-data-is-stored)
- [Move your data to another computer](#move-your-data-to-another-computer)
- [Update to a newer version](#update-to-a-newer-version)
- [Troubleshooting](#troubleshooting)

---

## What you need

1. **Node.js** (free). This is what runs the app in the background.
   - Go to <https://nodejs.org/en/download> and download the **LTS** installer for your computer
     (`.pkg` on a Mac, `.msi` on Windows).
   - Open the file you downloaded and click through the installer with the default choices.
   - You only do this once per computer.
2. **The app folder.** Download the ZIP from the public GitHub repo:
   <https://github.com/Anayasayo/Public-3DPrintCollectors/archive/refs/heads/main.zip>
   (or open <https://github.com/Anayasayo/Public-3DPrintCollectors>, click the green **Code** button,
   then **Download ZIP**).
3. An internet connection for the first start. It downloads the Magic card list (about 100 MB).

You do **not** need to use Terminal or the command line for anything below.

---

## Install on a Mac

1. **Install Node.js** (see [What you need](#what-you-need)).
2. **Unzip the app.** Double-click the downloaded ZIP. You get a folder called something like
   `3dprintcollectors-main`. Rename it to **`3DPrintCollectors`** if you like.
3. **Put the folder where it will live**, for example in your **Documents** folder. Don't leave it
   in Downloads, because it's easy to delete by accident. If you ever move it later, repeat step 4.
4. **Run the one-time setup.** Open the folder and double-click **`Install on Mac.command`**.
   - macOS will probably block it the first time, because it's not from the App Store. To allow it:
     - Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the
       message about "Install on Mac.command". Then click **Open**.
     - On older macOS versions, you can instead **right-click** (or Control-click) the file, choose
       **Open**, then click **Open** again.
   - A Terminal window opens and does the work. It takes a minute or two. When it says **Done!**,
     press Return to close it.
5. **Open the app.** A new app called **3DPrintCollectors** is now in your **Applications** folder
   (or in `Applications` inside your home folder if you're not an administrator). Double-click it.
   Your browser opens the app. Drag the app to your Dock to keep it handy.

**Closing it:** just close the browser tab. The app stops by itself about 30 seconds later. Open
it again from the Dock or Applications whenever you like.

---

## Install on Windows

1. **Install Node.js** (see [What you need](#what-you-need)).
2. **Unblock and unzip the app.** Right-click the downloaded ZIP → **Properties** → tick **Unblock**
   (if it's there) → **OK**. Then right-click the ZIP → **Extract All…** and pick a place such as
   `Documents`. Rename the folder to **`3DPrintCollectors`** if you like.
3. **Make a desktop shortcut.** In the folder, right-click **`Start 3DPrintCollectors.vbs`** →
   **Show more options** → **Send to** → **Desktop (create shortcut)**.
4. **Open the app.** Double-click the shortcut. The first start installs and builds the app in
   the background, which takes a minute or two. Nothing shows on screen until your browser opens.

**Closing it:** close the browser tab. The app stops by itself about 30 seconds later.

---

## First start

- The app opens at <http://127.0.0.1:5178> in your browser. That address only works on your own
  computer.
- A gold bar at the top says **"Updating card catalog from Scryfall…"** while it downloads the card
  list. Wait for it to finish, usually a few minutes, before importing cards or restoring a backup.
- **Optional, for better prices:** make a free account at <https://justtcg.com>, copy your API key,
  and paste it into **Settings → API key**. Without a key, the app still works and uses TCGplayer
  market prices instead.

---

## Where your data is stored

Everything is inside the app folder, in a folder called **`data`**:

| What | Where (inside the app folder) | Notes |
| --- | --- | --- |
| **Your collection, decks, wishlist, Misc, prices, settings** | `data/collection.db` | The one file that matters. While the app is open you may also see `collection.db-wal` and `collection.db-shm` next to it; they are part of it. |
| **Automatic backups** | `data/backups/` | A backup is made every time the app starts. The 20 newest are kept. |
| **Your JustTCG API key** | `.env` (in the app folder itself, not in `data`) | Not included in backups. Re-enter it in Settings on a new computer. |
| Mac start-up log | `data/server.log` | Only useful if something goes wrong. |

Examples of the full path:

- Mac: `/Users/yourname/Documents/3DPrintCollectors/data/collection.db`
- Windows: `C:\Users\yourname\Documents\3DPrintCollectors\data\collection.db`

The app also shows the exact path under **Settings → Backups** ("Database: …").

The Magic card list itself is **not** part of your data. Every computer downloads its own copy
automatically, which is why a backup file is small.

---

## Move your data to another computer

This works in any direction: Windows → Mac, Mac → Windows, Mac → Mac, and so on.

**On the old computer**

1. Open 3DPrintCollectors and go to **Settings**.
2. Under **Backups**, click **Download backup file**. Your browser saves a file named like
   `3DPrintCollectors-backup-2026-09-29.db`, usually into Downloads.
3. Copy that file to the new computer: USB stick, AirDrop, email, Google Drive, whatever is easiest.

**On the new computer**

1. Install the app (see above) and open it once.
2. **Wait for the card catalog download to finish.** The gold bar at the top disappears when it's
   done.
3. Go to **Settings → Backups**, click **Restore from a file…**, pick the backup file, and confirm.
4. Your collection, decks, wishlist, Misc, price history and settings are now on the new computer.
   Re-enter your JustTCG API key under **Settings → API key** if you use one.

Restoring **replaces** what's on the new computer. A safety backup of what was there is taken
first, so you can undo it from the backup list in Settings.

**Without the buttons:** you can also copy the files by hand. Close the app on both computers and
wait 30 seconds. Then copy the old computer's `data/collection.db` into the new computer's `data`
folder, replacing the file there. Any file from `data/backups/` also works with
**Restore from a file…**.

---

## Update to a newer version

1. In the current app, go to **Settings → Download backup file**, just to be safe.
2. Close the app. Download the new ZIP and unzip it.
3. Copy the **`data`** folder and the **`.env`** file from your old app folder into the new one.
   Files starting with a dot are hidden on a Mac; press **Cmd + Shift + .** in Finder to show them.
4. Replace the old folder with the new one.
5. **Mac:** double-click **`Install on Mac.command`** in the new folder again.
   **Windows:** nothing more to do; the next start rebuilds the app on its own.

Never copy the **`node_modules`** folder between computers. It holds parts made for one specific
computer. The installer recreates it.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Node.js is not installed" | Install the **LTS** version from <https://nodejs.org/en/download>, then open the app again. |
| Mac: "cannot be opened because Apple cannot verify it" | **System Settings → Privacy & Security → Open Anyway** (see [Install on a Mac](#install-on-a-mac), step 4). |
| Mac: "you don't have permission" when opening `Install on Mac.command` | Open **Terminal** (Applications → Utilities), type `bash ` (with a space), drag the file into the Terminal window, and press Return. |
| Mac setup mentions `gyp` or `xcode` | Open Terminal, run `xcode-select --install`, accept, then run the setup again. |
| Mac: "The 3DPrintCollectors folder was moved or deleted" | Run **`Install on Mac.command`** from the folder's new location. |
| The browser says the page can't be reached | Wait 10 seconds and refresh. If it's still down, open the app again from the Dock or shortcut. On a Mac, `data/server.log` shows what went wrong. |
| Restore says "The card catalog is still downloading" | Wait until the gold bar at the top is gone, then restore again. |
