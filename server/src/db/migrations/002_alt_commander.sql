-- Cards in the 99 that the player has short-listed as alternative commanders.
-- They stay part of the 99 for deck-size and legality; the flag only groups them in the UI
-- and marks them in exports.
ALTER TABLE deck_cards ADD COLUMN alt_commander INTEGER NOT NULL DEFAULT 0;
