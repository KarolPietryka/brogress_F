export const MUSCLE_GROUPS = ["Klata", "Plecy", "Nogi", "Ramiona", "Barki"];

export const BODY_PART_API_NAME = {
  Klata: "chest",
  Plecy: "back",
  Nogi: "legs",
  Ramiona: "arms",
  Barki: "shoulders",
};

/** Odwrotność {@link BODY_PART_API_NAME} — odpowiedź GET /workout */
export const BODY_PART_TO_GROUP_LABEL = {
  chest: "Klata",
  back: "Plecy",
  legs: "Nogi",
  arms: "Ramiona",
  shoulders: "Barki",
};
