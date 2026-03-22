# Forest — Plantation Session Tracker

Forest is a tool for managing and tracking tree plantation sessions in a field. It helps teams record what was planted, where, and when — and provides insights into the field's composition over time.

## Core Concepts

- **Species** — A type of tree (e.g., *Eucalyptus grandis*, *Pinus elliottii*). Serves as a reference catalog for all trees in the field.
- **Region** — A bounded area of the field, represented as a rectangular box. Regions are the spatial unit for organizing plantations.
- **Session** — A plantation event: a set of trees planted on a specific date in a specific region.
- **Tree** — An individual tree planted during a session, linked to both its species and the session it belongs to.

## What You Can Do

- **Register plantation sessions** — Record when and where trees were planted, along with which species were used.
- **Manage species** — Add and maintain the catalog of tree species available for planting.
- **Query a region** — See all trees currently planted in a given region, organized by session or species.
- **View region stats** — Get aggregated statistics for a region, such as total tree count, species diversity, and plantation history.

## Goal

The goal of Forest is to give field teams a clear, queryable record of plantation activity — making it easy to understand the current state of any region and track how the field evolves over time.
