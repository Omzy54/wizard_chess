export interface GameConfig {
  boardSize: number;
  maxHp: number;
  startingMana: number;
  manaRegen: number;
  maxMana: number;
  maxSpellLevel: number;
  boltDamage: number;
  /** Arcane Bolt damage against a frozen wizard. */
  frozenBoltDamage: number;
  /**
   * How many of the frozen wizard's turn starts the ice lasts. 3 roots them for their next two
   * turns and gives the caster two chances at a double-damage bolt.
   */
  frostTurns: number;
  gustDistance: number;
  siphonAmount: number;
  /** Turns a wizard loses when a Thundercloud strikes them. */
  stunTurns: number;
  /**
   * How far a Thundercloud reaches. A wizard who lands within this many squares of one is
   * struck. 0 means only the cloud's own square.
   */
  cloudReach: number;
  /** Squares a wizard standing next to a shattered wall is thrown. */
  blastDistance: number;
  /** Extra mana per turn once a wizard has reached the enemy's home corner. */
  attunementBonus: number;
  /**
   * Round at whose start the arcane storm engulfs the outer ring of the board. 0 turns the
   * storm off.
   */
  stormStartRound: number;
  /** Rounds between the storm taking each further ring, until nothing is left. */
  stormInterval: number;
  /** Damage a wizard takes for ending their turn inside the storm. */
  stormDamage: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  boardSize: 8,
  maxHp: 5,
  startingMana: 1,
  manaRegen: 1,
  maxMana: 5,
  maxSpellLevel: 3,
  boltDamage: 1,
  frozenBoltDamage: 2,
  frostTurns: 3,
  gustDistance: 2,
  siphonAmount: 2,
  stunTurns: 1,
  cloudReach: 1,
  blastDistance: 2,
  attunementBonus: 1,
  stormStartRound: 12,
  stormInterval: 8,
  stormDamage: 1,
};
