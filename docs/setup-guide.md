# Putting Beta online: step-by-step guide

This guide is for someone who has never used Supabase, Google Cloud or Vercel. Follow it top to bottom, and keep these two values handy:

- **Supabase project URL:** `https://nofgagvbsfmtcwcpkzer.supabase.co`
- **Supabase publishable key:** the `sb_publishable_...` key from your Supabase dashboard (**Project Settings → API Keys**)

Never paste the Supabase **secret** key or the Google **client secret** into a chat, an email or the app's settings. They only go where this guide says.

It takes about 30 minutes. You will:

1. Merge the code on GitHub
2. Create the database tables in Supabase
3. Put the app on Vercel
4. Create a Google sign-in client
5. Connect Google to Supabase
6. Test it

---

## 1. Merge the code on GitHub (2 minutes)

Vercel publishes whatever is on the `main` branch, so the foundation code has to be merged first.

1. Open https://github.com/betasportsmvp/sportsmvp/pull/1 and sign in as **betasportsmvp**.
2. Scroll to the bottom and click the green **Merge pull request** button, then **Confirm merge**.

## 2. Create the database tables in Supabase (3 minutes)

1. Open the migration file: https://github.com/betasportsmvp/sportsmvp/blob/main/supabase/migrations/20261016000000_foundation.sql
2. Click the **Copy raw file** button (two overlapping squares, top right of the file).
3. Open your Supabase project at https://supabase.com/dashboard/project/nofgagvbsfmtcwcpkzer
4. In the left sidebar, click **SQL Editor**, then **+ New query**.
5. Click inside the big text box, paste (Cmd+V), and click **Run** (bottom right).
6. You should see **Success. No rows returned**. If Supabase asks you to confirm because the query is "destructive", click **Run this query**.
7. Check it worked: in the left sidebar click **Table Editor**. You should see tables including `groups`, `memberships` and `profiles`.

Run this only once. If you run it a second time, you'll get an error such as `type "member_role" already exists`, which is harmless.

## 3. Put the app on Vercel (10 minutes)

1. Go to https://vercel.com/signup, choose **Hobby** (free), and click **Continue with GitHub**. Sign in as **betasportsmvp** and allow access.
2. On the Vercel dashboard click **Add New… → Project**.
3. Find **sportsmvp** in the list and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions**, allow the `sportsmvp` repository, and come back.
4. On the **Configure Project** screen:
   - **Project Name:** `beta-sports` (or anything you like; it becomes part of the web address).
   - **Root Directory:** click **Edit**, choose **apps/web**, and click **Continue**. This step is required.
   - **Framework Preset:** it should say **Next.js** by itself.
   - Open **Environment Variables** and add these three, one at a time (type the name in **Key**, the value in **Value**, then click **Add**):

     | Key | Value |
     | --- | --- |
     | `NEXT_PUBLIC_SUPABASE_URL` | `https://nofgagvbsfmtcwcpkzer.supabase.co` |
     | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | your `sb_publishable_...` key |
     | `NEXT_PUBLIC_APP_NAME` | `Beta` |

5. Click **Deploy** and wait for the confetti (2–3 minutes).
6. Click **Continue to Dashboard**. Under **Domains** you'll see your web address, for example `https://beta-sports.vercel.app`. **Write it down**: the rest of this guide calls it *your app address*.
7. Tell the app its own address:
   - Click **Settings → Environment Variables** and add `NEXT_PUBLIC_SITE_URL` with *your app address* as the value (no slash at the end). Click **Save**.
   - Click **Deployments**. On the top deployment, click the **⋯** menu and then **Redeploy → Redeploy**.

Opening *your app address* should now show the Beta welcome page. Sign-in won't work until steps 4 and 5 are done.

## 4. Create a Google sign-in client (10 minutes)

1. Go to https://console.cloud.google.com and sign in with your Google account. Accept the terms if asked.
2. **Create a project:** click the project picker at the top left (it may say **Select a project**), click **New project**, name it `Beta`, and click **Create**. Make sure `Beta` is selected in the picker afterwards.
3. **Set up the consent screen** (what people see when they sign in):
   - Open https://console.cloud.google.com/auth/overview and click **Get started**.
   - **App name:** `Beta`. **User support email:** your email. Click **Next**.
   - **Audience:** choose **External**. Click **Next**.
   - **Contact information:** your email. Click **Next**, tick the agreement, and click **Continue**, then **Create**.
4. **Create the client:**
   - Open https://console.cloud.google.com/auth/clients and click **+ Create client**.
   - **Application type:** **Web application**. **Name:** `Beta web`.
   - Under **Authorized JavaScript origins** click **+ Add URI** and enter *your app address* (for example `https://beta-sports.vercel.app`).
   - Under **Authorized redirect URIs** click **+ Add URI** and enter exactly:
     `https://nofgagvbsfmtcwcpkzer.supabase.co/auth/v1/callback`
   - Click **Create**.
5. A box shows your **Client ID** and **Client secret**. Keep this tab open, or click **Download JSON** to save them. You'll paste them in step 5.
6. **Let your group sign in:** while the app is in Google's "Testing" mode, only listed people can sign in.
   - Open https://console.cloud.google.com/auth/audience. Under **Test users** click **+ Add users**, enter the Gmail addresses of you and your players, and click **Save** (up to 100 people).
   - Later, when you're ready for anyone to sign in, click **Publish app** on the same page.

## 5. Connect Google to Supabase (3 minutes)

1. In Supabase, open **Authentication** in the left sidebar, then **Sign In / Providers**.
2. Click **Google**, turn on **Enable Sign in with Google**, paste the **Client ID** and **Client Secret** from step 4, and click **Save**.
3. Still under **Authentication**, open **URL Configuration**:
   - **Site URL:** *your app address*, then click **Save**.
   - **Redirect URLs:** click **Add URL**, enter *your app address* followed by `/auth/callback` (for example `https://beta-sports.vercel.app/auth/callback`), and click **Save URLs**.

## 6. Test it (2 minutes)

1. Open *your app address* on your phone or computer and click **Continue with Google**. Pick your account.
2. You should land on **Your groups**. Create a group.
3. On the group page, click **Create invite link** and copy the link.
4. Open that link in a private/incognito window, sign in with a **different** Google account (one you added as a test user), and click **Join group**.
5. Back in your own window, refresh the group page: the second person is now in the member list.

On your phone you can add the app to your home screen: in Safari tap **Share → Add to Home Screen**, or in Chrome tap **⋮ → Add to Home screen**.

---

## If something goes wrong

| What you see | What to check |
| --- | --- |
| Google says **Error 400: redirect_uri_mismatch** | Step 4.4: the redirect URI must be exactly `https://nofgagvbsfmtcwcpkzer.supabase.co/auth/v1/callback` |
| Google says **Access blocked: app has not completed verification** | Step 4.6: add that Gmail address as a test user |
| You return to the welcome page with **Sign-in didn't complete** | Step 5.3: the redirect URL must be *your app address* + `/auth/callback` |
| Google says the provider is not enabled | Step 5.2: Google is switched on and saved in Supabase |
| **Something went wrong** when creating a group | Step 2: the SQL was run and the tables exist |
| Vercel build fails | Step 3.4: Root Directory is `apps/web` and all three variables are set |

If you get stuck, copy the exact error message (or take a screenshot) and send it in the project thread.
