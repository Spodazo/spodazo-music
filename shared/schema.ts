import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const albums = pgTable("albums", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  tagline: text("tagline").notNull().default(""),
  credits: text("credits").notNull().default(""),
  artists: text("artists").notNull().default(""),
  copyright: text("copyright").notNull().default(""),
  heroPortrait: text("hero_portrait").notNull().default(""),
  thumb: text("thumb").notNull().default(""),
  artistThumb: text("artist_thumb").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const playerSetup = pgTable("player_setup", {
  id: text("id").primaryKey(),
  appName: text("app_name").notNull().default(""),
  theme: text("theme").notNull().default(""),
  credits: text("credits").notNull().default(""),
  copyright: text("copyright").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const tracks = pgTable("tracks", {
  id: text("id").primaryKey(),
  albumId: text("album_id")
    .notNull()
    .references(() => albums.id, { onDelete: "cascade" }),
  n: integer("n").notNull(),
  title: text("title").notNull(),
  scripture: text("scripture").notNull().default(""),
  file: text("file").notNull().default(""),
  img: text("img").notNull().default(""),
  key: text("key").notNull().default(""),
  lyrics: text("lyrics").notNull().default(""),
  introduction: text("introduction").notNull().default(""),
  instrumental: boolean("instrumental").notNull().default(false),
  slug: text("slug").notNull().default(""),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
