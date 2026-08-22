# solstice-checkin
A synchronous event check-in system built with Node.js and Express, allowing users to register for events, submit check-ins, and receive real-time confirmation. This project serves as the baseline system for exploring reliability and asynchronous architecture improvements.


# Weekly Overview — Solstice Project

## Week Overview

This week focused on developing and understanding the **Solstice Check-In system**, beginning with the original synchronous implementation and later introducing a project pivot on Thursday.

### Monday — New Technology Exploration

I began the week by exploring **Retry with Exponential Backoff** as a new technology/concept.

I researched how retry mechanisms work, why exponential backoff is useful, and how increasing delays can help systems handle temporary failures. I started developing a small standalone prototype to test the concept.

### Tuesday — Prototype Development

I continued working on the Retry with Exponential Backoff prototype.

I implemented and tested different scenarios, including successful operations, temporary failures, and repeated failures. I also worked on controlling the maximum number of retry attempts.

By the end of the day, the standalone prototype was working.

### Wednesday — Solstice Baseline

I moved my focus to the **Solstice Check-In system** and began working with the original synchronous architecture.

The main flow was:

**Frontend → Express Server → Processing → Response**

The goal was to establish the baseline system before making any architectural changes.

### Thursday — Project Pivot

On Thursday, the project direction changed with the introduction of a **pivot**.

Instead of only continuing with the original synchronous approach, the project began moving toward exploring a more **asynchronous and reliable architecture**.

This pivot created a distinction between:

**Original system:**

Frontend → Server → Processing → Response

and the proposed direction:

Frontend → Server → Message/Event → Asynchronous Processing

The pivot meant that the original synchronous system would serve as the **baseline** against which the new approach could later be compared.

### Overall Progress

By the end of the week:

* The Retry with Exponential Backoff prototype was completed.
* The original Solstice synchronous system was established as the baseline.
* The project pivot was introduced on Thursday.
* The new direction toward asynchronous processing was identified.
* Further implementation and testing of the new architecture will follow in the next stage.

## Key Learning

The main lesson from this week was that building a working baseline before introducing a major architectural change makes it easier to understand and measure the impact of the new approach.

The week therefore progressed from **learning → prototyping → baseline development → architectural pivot**.
