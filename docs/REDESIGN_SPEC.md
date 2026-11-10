# Redesign spec: a simple company document library

**Purpose:** employees find, view and download the documents and licences the company has uploaded.
Administrators upload and organise them. Nothing else.

**Who uses it:** every employee, none of them technical. The rule for every screen is that someone who
has never seen it can do the job without help.

**Design rules**

1. One clear main action per screen.
2. Everyday words only.
3. Folders at most 3 levels deep.
4. **View** and **Download** sit in the same place on every file.
5. When in doubt, leave it out.

---

## 1. Features kept and removed

The current app was built for an agency managing many client companies, reviewing each employee's
certificates. The new purpose is much narrower, so most of that machinery goes.

### Kept

| Feature | Who | Why it stays |
|---|---|---|
| Sign in / sign out | Everyone | Documents are confidential. Becomes **one** sign-in page (no "choose your portal"); the account decides what you see. |
| Search | Everyone | The fastest way to find anything. One box, matches file names, folder names and partial words ("insur" finds "Insurance Certificate"). |
| Folders (max 3 levels) | Everyone | How people already think about paper files: Licences → 2025. |
| Recently added | Everyone | Answers "what's new?" without searching. |
| View (in-app preview) | Everyone | Most files are PDFs or images; opening them should not need a download. |
| Download | Everyone | The other half of the job. |
| File details: name, date added, type, size | Everyone | Exactly the four facts the brief asks for, in plain words. |
| "Valid until" date (optional, licences only) | Everyone sees it, admins set it | An expired licence is worse than none. Shown as a plain label: *Valid until 12 March 2026* / *Expired*. |
| Upload files | Admins | Core admin job. |
| Create, rename, delete folders | Admins | Core admin job. |
| Rename, move, delete files | Admins | Core admin job. |
| Replace a file with a newer copy | Admins | Renewing a licence keeps the same name and link. Old copy kept silently for recovery. |
| People: add, remove, reset password | Admins | Someone has to give access. Kept to three actions; drop it entirely if the company uses Microsoft/Google sign-in (see §5). |
| Change my password | Everyone | Basic account hygiene. |
| Two-step sign-in **for admins only** | Admins | Admins can delete the company's documents; a stolen password must not be enough. Employees never see it. |
| Activity recording (silent) | Nobody sees it | Who viewed/downloaded/changed what is still recorded in the background for security and audits. The screen goes; the record stays. |
| Private, encrypted cloud storage | Nobody sees it | Set up once by IT. Not part of daily use. |

### Removed

| Feature (today) | Why it goes |
|---|---|
| **Client companies** (multi-company setup) | It's one company's internal tool. |
| **Staff role + 13-permission matrix + client assignments** | Replaced by two roles: *Admin* (manages files) and *Employee* (views and downloads). No matrix to understand or get wrong. |
| **Review / approval workflow** (Pending, Approved, Rejected, Renewal Required) | Admins upload trusted company documents. There's nothing to approve. |
| **Review queue** page | Same reason. |
| **Document requests / tasks** | Employees don't upload anything. |
| **Comments and internal notes** | Not needed to view or download. Questions go to the admin directly. |
| **Analytics dashboard** (stat cards, charts, status breakdowns, activity feed) | Not part of "find and open a document". Replaced by a simple Home. |
| **Getting-started checklist** | With only "upload" and "make folders" to learn, an empty-state message does the job. |
| **Notifications bell** | There are no approvals or rejections to announce. A small **New** label on recently added files covers "what changed". |
| **Expiry tracking page, 90/60/30-day reminders, renewal statuses** | Reduced to the optional "Valid until" label. (Admin reminders can return later as one email, not a screen.) |
| **Per-employee folders and "categories" as a separate concept** | One shared folder tree. Old categories become top-level folders. |
| **Advanced filters** (status, file type, uploader, date ranges, archived) | One search box plus a "Sort by" control. |
| **Bulk select + drag-and-drop between folders** | Replaced by **Move** in each file's menu: harder to do by accident, easier to understand. |
| **Archive** (separate from delete) | Two ways to make a file disappear confuse people. Just **Delete**, with a confirmation and a 30-day "Recently deleted" safety net for admins. |
| **Version history, checksums, file IDs** in the file screen | Technical details. The previous copy is still kept quietly after **Replace**. |
| **Audit log screen** | Recording continues (see Kept); the screen and its filters go. IT can export the record if ever needed. |
| **File Storage settings screen** | One-time IT setup, not an admin task. Moved out of the admin menu. |
| **Help page with long FAQs** | The interface should explain itself. Kept as one short "Need help?" note with the admin's contact. |
| **Separate Admin & Employee portals** | One sign-in page. |

**Result:** the menu goes from 15 items to **Home** for employees, and **Home** plus **People** for admins.
Everything else happens inside folders.

---

## 2. Screen-by-screen layout

Layouts are described for desktop; on phones every row stacks into a single column with the same order.

### 2.1 Sign in

- Company logo, then **"Sign in to Company Documents"**.
- Email, Password, **Sign in** (primary, full width).
- Small link: *Forgot your password?* → "Ask your administrator for a reset link."
- **Primary action:** Sign in.

### 2.2 Home

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Logo] Company Documents                         Jordan Lee ▾        │
├──────────────────────────────────────────────────────────────────────┤
│        Find a document                                               │
│  ┌──────────────────────────────────────────────┐ ┌────────┐         │
│  │ 🔍  Search for a document…                   │ │ Search │         │
│  └──────────────────────────────────────────────┘ └────────┘         │
│                                                                      │
│  Folders                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │   📁     │ │   📁     │ │   📁     │ │   📁     │                 │
│  │ Licences │ │HR Policies│ │ Finance  │ │ Health & │                 │
│  │ 24 files │ │ 12 files │ │  9 files │ │ Safety 7 │                 │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                 │
│                                                                      │
│  Recently added                                                      │
│  📄 Fire Safety Licence 2025   Added 3 Mar 2025 · PDF · 1.2 MB  [View] [Download] │
│  📄 Holiday Policy             Added 28 Feb 2025 · PDF · 240 KB [View] [Download] │
│  …(6 most recent)                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

- The search box sits at the top, is wide and is focused on page load (desktop).
- Folder tiles: large icon, name in 18px bold, file count underneath. At most 8 top-level folders.
- Recently added: the 6 newest files across all folders, each with its folder name in grey ("in Licences › 2025").
- Admins see one extra button top-right: **Add files** (primary for admins).
- **Primary action:** Search (employees) / Add files (admins).

### 2.3 Folder view

```
 Home › Licences › 2025                                   [Sort by: Newest first ▾]

 ┌──────────┐ ┌──────────┐         ← sub-folders first (if any)
 │ 📁 Q1    │ │ 📁 Q2    │
 └──────────┘ └──────────┘

 Name                          Date added      Type    Size
 📄 Fire Safety Licence        3 Mar 2025      PDF     1.2 MB    [View] [Download]
    Valid until 2 Mar 2026
 📄 Waste Carrier Licence      14 Jan 2025     PDF     800 KB    [View] [Download]
    ⚠ Expired on 1 Feb 2025
```

- Breadcrumb at the top in full words; every part is a link. "Home" is always first.
- Sub-folders shown as tiles above the file list.
- File rows: name (bold, wraps rather than truncates), date added ("3 Mar 2025"), type in words (PDF, Word, Excel, Image), size (KB/MB).
- **View** (outlined) and **Download** (filled) at the right end of every row, always in this order.
- "Valid until" shown under the name only when set. Expired licences get a warning icon **and** the word "Expired".
- A small search box: *Search in Licences…*
- Sort options: *Newest first* (default) / *Name A–Z*.
- Admin only: **Add files to this folder** (primary), **New folder** (secondary), and a **⋯** menu on each row: Rename · Move · Replace with a newer copy · Delete.
- **Primary action:** View on each file (employees) / Add files to this folder (admins).

### 2.4 File view

```
 ← Back to Licences                                              
 Fire Safety Licence 2025                                [Download]
 Added 3 March 2025 · PDF · 1.2 MB · Valid until 2 March 2026
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │                  (document shown here)                       │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘
```

- Opens full width, same tab. **Back** returns to where you came from (folder or search results).
- Word/Excel files that can't be shown: a friendly panel, *"This file can't be shown here. Download it to open it."*, with a large **Download** button.
- Admin only, small and secondary: Rename · Move · Replace · Delete (same menu as in the folder).
- **Primary action:** Download.

### 2.5 Search results

- Heading: **12 results for "insurance"**.
- The same row layout as a folder, plus the folder path under each name (*in Finance › Insurance*), which is a link.
- Matching folders are listed first as tiles, files below.
- No results: *"We couldn't find anything for 'insurnce'. Check the spelling or try a shorter word."* plus **Back to Home**.
- **Primary action:** View on the first result.

### 2.6 Admin: Add files

```
 Add files
 ┌────────────────────────────────────────────────────────────┐
 │        Drag files here, or  [Choose files]                  │
 │     PDF, Word, Excel or pictures · up to 25 MB each          │
 └────────────────────────────────────────────────────────────┘
 Put them in:  [ Licences › 2025        ▾ ]   (defaults to the folder you came from)

 Fire Safety Licence 2025.pdf    Name: [Fire Safety Licence 2025   ]   Valid until (optional): [      ]   ✕
 Holiday Policy.docx             Name: [Holiday Policy             ]                                      ✕

                                                              [Add 2 files]
```

- **Minimum fields:** the file and its folder. The name is pre-filled from the file name and editable.
  *Valid until* appears only for files going into a Licences folder and is optional.
- Removed from today's upload form: employee picker, category, issue date, description, request link,
  review step.
- After upload: *"2 files added to Licences › 2025."* with **Go to folder** and **Add more files**.
- **Primary action:** Add files.

### 2.7 Admin: small dialogs

| Dialog | Fields | Main button |
|---|---|---|
| New folder | Folder name | **Create folder** |
| Rename | Name | **Save name** |
| Move | Folder picker (tree, max 3 levels) | **Move here** |
| Replace with a newer copy | Choose file, Valid until (licences) | **Replace file** |
| Delete file | (confirmation only) | **Delete** (red) |
| Delete folder | (confirmation; only empty folders, otherwise explain) | **Delete folder** (red) |

### 2.8 Admin: People

- List of names and emails with **Admin** or **Employee** shown next to each.
- **Add a person** (primary): Name, Email, "Can manage documents?" (Yes/No). They get a link to set a password.
- Row menu: **Send password reset link** · **Remove access**.

---

## 3. Microcopy

### Navigation and headings

| Place | Text |
|---|---|
| App name | Company Documents |
| Menu | Home · People *(admins)* |
| Home search heading | Find a document |
| Search placeholder | Search for a document… |
| Folder search placeholder | Search in {Folder}… |
| Home sections | Folders · Recently added |
| File details | Added {3 Mar 2025} · {PDF} · {1.2 MB} |
| Licence date | Valid until {2 Mar 2026} · Expires in {12} days · Expired on {1 Feb 2025} |
| File type words | PDF · Word document · Excel sheet · Picture |
| Account menu | Change my password · Sign out |

### Buttons

| Button | Text |
|---|---|
| Open a file | View |
| Save a file | Download |
| Search | Search |
| Go back | Back to {Folder} / Back to Home |
| Sort | Sort by: Newest first / Name A–Z |
| Admin: upload | Add files · Add files to this folder · Choose files · Add {n} files |
| Admin: folders | New folder · Create folder · Rename · Delete folder |
| Admin: files | Rename · Move · Move here · Replace with a newer copy · Replace file · Delete |
| Admin: people | Add a person · Send password reset link · Remove access |
| Dialogs | Cancel · Save name · Done |

### Messages

| Situation | Message |
|---|---|
| Empty folder (employee) | This folder is empty. |
| Empty folder (admin) | This folder is empty. Add files to get started. **[Add files]** |
| Nothing uploaded yet (admin home) | No documents yet. Start by adding your first files. **[Add files]** |
| No search results | We couldn't find anything for "{term}". Check the spelling or try a shorter word. |
| Can't preview | This file can't be shown here. Download it to open it. |
| Downloading | Your download has started. |
| Upload success | {n} files added to {Folder path}. |
| Upload — wrong type | "{file}" can't be added. Use a PDF, Word, Excel or picture file. |
| Upload — too big | "{file}" is too big. Files can be up to 25 MB. |
| Upload — no folder chosen | Choose a folder for these files. |
| Name already used | There's already a file called "{name}" in this folder. Choose another name. |
| Confirm delete file | Delete "{name}"? People will no longer see it. You can restore it from Recently deleted for 30 days. |
| Confirm delete folder (not empty) | This folder still has {n} files. Move or delete them first. |
| Moved | "{name}" moved to {Folder path}. |
| Replaced | "{name}" updated. Everyone now sees the new copy. |
| Wrong password | That email and password don't match. Try again or ask your administrator for help. |
| Signed out (idle) | You were signed out to keep documents safe. Please sign in again. |
| No access | You don't have access to this. Ask your administrator if you need it. |
| Something broke | Something went wrong. Please try again. If it keeps happening, tell your administrator. |
| Need help (footer) | Need help? Contact {admin name} at {email}. |

---

## 4. Accessibility

- **Text size:** 16px minimum body text, 18px file and folder names, 24–28px page titles. Layout
  holds up at 200% browser zoom without sideways scrolling.
- **Contrast:** at least 4.5:1 for all text and 3:1 for icons and button borders (WCAG 2.2 AA).
  Dark navy text on white; blue buttons with white text checked against AA.
- **Click targets:** at least 44×44px. View/Download buttons 44px tall with 8px gaps so they can't be
  mis-tapped. Whole folder tiles are clickable, not just the name.
- **Never colour alone:** "Expired" is a word plus an icon, not just red. File types are written out
  ("PDF"), not just icon colours.
- **Clear labels for screen readers:** every button names its file, e.g. *"Download Fire Safety
  Licence 2025, PDF, 1.2 MB"*. Breadcrumbs use a navigation landmark labelled "You are here".
- **Keyboard:** everything reachable with Tab in reading order; visible focus ring (3px); Enter opens,
  Esc closes dialogs; focus returns to the button that opened a dialog.
- **Predictable:** View and Download always in the same place; files open in the same tab with a
  clear Back; no actions hidden behind hover.
- **Plain language:** short sentences (reading age ~11), no jargon, full dates ("3 Mar 2025",
  never "2025-03-03").
- **Motion:** minimal; respects the system "reduce motion" setting.
- **Previews:** PDFs keep their text layer for screen readers; a Download fallback is always on screen.
- **Timeouts:** warn 2 minutes before automatic sign-out with a **Stay signed in** button.

---

## 5. Keeping it simple as the library grows

1. **Fix the top level.** Agree on 5–8 top-level folders (e.g. *Licences, HR Policies, Finance, Health &
   Safety, Forms & Templates, Company Information*). Only admins can create top-level folders, and
   nothing goes deeper than 3 levels. Inside busy folders, add one sub-folder per year
   (*Licences › 2025*).
2. **One naming pattern at upload.** *What – Where/Who – Year*, e.g. "Fire Safety Licence – London
   Office – 2025". The upload form suggests a name from the file and warns about duplicates ("There's
   already a file called…"). Good names make search work.
3. **Let search do the heavy lifting.** Search matches names, folder names, partial words and common
   spelling variants (licence/license, policy/policies). Results show the folder path, so people
   learn where things live without browsing.
4. **Tidy up on a schedule.** Expired licences move automatically into a yearly *Old licences* folder.
   Once a quarter, admins get a short list of files nobody has opened in 12 months to delete or keep.
   If a folder passes ~30 files, split it by year.
5. **Use company sign-in when possible.** Connecting Microsoft 365 or Google Workspace sign-in removes
   passwords and the People screen entirely: everyone in the company gets access, and leavers lose
   it automatically.

---

## 6. What implementing this means for the current app

| Area | Change |
|---|---|
| Data | Documents stop belonging to an employee/client; they belong to a folder. Categories become top-level folders. Review status, requests and comments are no longer used (kept in the database for history, hidden in the UI). |
| Roles | Admin and Employee only. Employees can view and download **all** company documents (optionally per-folder restriction later). Staff accounts become Admins or Employees. |
| Screens kept / rebuilt | Sign in (single), Home, Folder, File, Search results, Add files, People, Change password. |
| Screens removed from the UI | Dashboard analytics, Documents table with filters, Review queue, Expiry tracking, Requests, Employees, Clients, Categories, Audit log, File storage, Notifications, long Help page. |
| Kept in the background | Encrypted private storage with short-lived links, activity recording, admin two-step sign-in, lockout and rate limits, automated tests and CI. |
