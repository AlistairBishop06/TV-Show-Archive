# TV Archive

<p align="center">
  <img src="public/assets/tv-archive-logo.png" alt="TV Archive" width="420">
</p>

<p align="center">
  A full-stack streaming-style web application for discovering, organising and watching movies, television and live sports.
</p>

---

## Overview

**TV Archive** is a full-stack web application inspired by modern streaming platforms.

It combines movie and television discovery, user accounts, cross-device watch progress, personalised lists, trailers, live sports schedules and embedded playback into a single responsive interface.

The project began as a simple TV episode browser and has evolved into a considerably larger application involving frontend development, authentication, PostgreSQL persistence, third-party APIs, responsive UI design and serverless deployment.

### Key Goals

- Build a polished streaming-platform-style interface from scratch
- Support both movies and television
- Maintain watch progress across devices
- Keep database usage efficient on a serverless architecture
- Integrate multiple external metadata and media services
- Provide live sports discovery and schedules
- Create a responsive experience across desktop and mobile
- Maintain a lightweight architecture suitable for free-tier hosting

---

# Features

## Movies & Television

TV Archive provides a unified catalogue for movies and television shows.

Users can:

- Browse popular movies and TV series
- Filter between All, TV Shows and Movies
- Browse titles by genre
- Open detailed title information
- Browse seasons and episodes
- Search across the catalogue
- Resume previously watched titles
- View dynamically generated featured content
- Watch trailers directly inside the interface

Content is presented using responsive media rows similar to commercial streaming platforms.

---

## Playback

Movies and episodes open inside TV Archive's dedicated full-screen player.

The player supports:

- Resume position
- Episode information
- Season and episode tracking
- Playback progress monitoring
- Fullscreen playback
- Automatic next-episode handling
- Browser history integration
- Clean return-to-TV-Archive navigation

Playback providers are isolated from the rest of the application so they can be replaced without redesigning the catalogue or account systems.

---

## Cross-Device Watch Progress

Watch history is associated with the signed-in user rather than the browser.

TV Archive records:

- Movie or series
- Season
- Episode
- Episode title
- Playback position
- Duration
- Last watched time
- Poster and backdrop metadata

The **Currently Watching** section allows users to resume exactly where they stopped.

### Database Optimisation

The application deliberately avoids continuously writing playback progress to the database.

During playback, progress is stored locally.

The database is only synchronised at meaningful checkpoints such as:

- Pause
- Seeking
- Episode completion
- Leaving the player
- Closing or navigating away from the page

This significantly reduces unnecessary serverless database activity.

---

# Accounts

TV Archive includes its own username and password authentication system.

Users can:

- Register an account
- Sign in
- Sign out
- Change username
- Change password
- Upload a profile picture
- Remove their profile picture
- View their account creation date

Passwords are never stored in plaintext.

They are hashed server-side using **scrypt** before being written to the database.

Authentication uses random bearer session tokens, while only hashed versions of those tokens are stored server-side.

---

# Watch Later

Any movie or television show can be added to the user's **Watch Later** collection.

Saved titles are synchronised with the user's account and can be opened directly from their profile.

---

# Custom Lists

Users can create their own collections of movies and television shows.

Lists support:

- Custom names
- Rename
- Delete
- Add or remove titles
- Public or private visibility
- Case-insensitive unique names per user

Example lists might include:

> Best 90s Sitcoms  
> Films to Watch This Weekend  
> Favourite Sci-Fi  
> Top TV Shows

---

# Discover Lists

Public lists created by other users can be explored through the **Discover Lists** section.

Users can:

- Browse public collections
- Expand a collection
- View all included titles
- Open titles directly from a shared list
- Copy a shareable link to a collection

This adds a lightweight social discovery layer without requiring followers or a traditional social network.

---

# Live Sports

TV Archive includes a dedicated **Live Sports** section.

There are two browsing modes.

## Featured

Featured contains a curated collection of sports channels organised by region.

Current regions include:

- United Kingdom
- Germany & Austria
- Italy
- New Zealand

Featured channels appear using the same media-card design used throughout the main TV catalogue.

---

## All Sports

The **All** section dynamically builds a sports directory from the current live schedule.

Sports are automatically categorised into sections such as:

- Football
- Tennis
- Basketball
- Motorsport
- Combat Sports
- Rugby
- Cricket
- Golf
- Baseball
- Ice Hockey
- American Football
- Darts
- Athletics
- Volleyball

Each event is displayed using a responsive media card with:

- Sport-specific thumbnail
- Event title
- Start time
- Channel or source
- Watch action

Users can also search the live schedule and filter by sport.

---

## Live Schedule

The backend reads live schedule information and converts it into structured data for the frontend.

Rather than embedding an external schedule interface, TV Archive renders the information using its own components so the live-sports experience remains consistent with the rest of the application.

Schedule responses are cached briefly to reduce unnecessary upstream requests.

---

# Trailer System

Trailers are integrated throughout the application.

They can appear:

- Behind the featured hero
- Inside movie and show detail views
- As desktop hover previews on media cards

Trailer previews are:

- Muted automatically
- Loaded only when required
- Destroyed when no longer visible
- Disabled on touch devices
- Disabled when reduced-motion accessibility settings are enabled

This keeps the interface responsive while still creating a streaming-platform feel.

---

# Search & Discovery

Search supports both movies and TV shows and works across dedicated routes.

The application also provides:

- Genre-based discovery
- Popular-title rows
- Featured content
- Search result grids
- Category pages
- See All views
- Incremental catalogue loading

---
