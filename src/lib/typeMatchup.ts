import fs from 'fs';
import path from 'path';

interface TypeEffectiveness {
    Weaknesses: string[];
    Resistances: string[];
    Immunities: string[];
}

interface TypeWeaknessData {
    defense_effectiveness: {
        [typeName: string]: TypeEffectiveness;
    };
}

let typeData: TypeWeaknessData | null = null;

/**
 * Load type weakness data from JSON file
 */
function loadTypeData(): TypeWeaknessData {
    if (!typeData) {
        const filePath = path.join(process.cwd(), 'type_weakness.json');
        const rawData = fs.readFileSync(filePath, 'utf-8');
        typeData = JSON.parse(rawData) as TypeWeaknessData;
    }
    return typeData;
}

/**
 * Calculate type effectiveness multipliers for a Pokemon with given types
 * @param types - Array of type names (1 or 2 types)
 * @returns Object mapping attack types to their effectiveness multipliers
 */
export function calculateWeaknesses(types: string[]): Record<string, number> {
    const data = loadTypeData();
    const multipliers: Record<string, number> = {};

    // Initialize all types with 1x effectiveness
    for (const attackType of Object.keys(data.defense_effectiveness)) {
        multipliers[attackType] = 1;
    }

    // Calculate combined effectiveness for all defending types
    for (const defendingType of types) {
        const typeInfo = data.defense_effectiveness[defendingType];

        if (!typeInfo) {
            console.warn(`Unknown type: ${defendingType}`);
            continue;
        }

        // Apply weaknesses (2x)
        for (const weakness of typeInfo.Weaknesses) {
            multipliers[weakness] *= 2;
        }

        // Apply resistances (0.5x)
        for (const resistance of typeInfo.Resistances) {
            multipliers[resistance] *= 0.5;
        }

        // Apply immunities (0x)
        for (const immunity of typeInfo.Immunities) {
            multipliers[immunity] = 0;
        }
    }

    return multipliers;
}

/**
 * Format weaknesses into a human-readable structure
 */
export function formatWeaknesses(multipliers: Record<string, number>) {
    const result = {
        x4_weakness: [] as string[],      // 4x
        x2_weakness: [] as string[],      // 2x
        x0_5_resistance: [] as string[],  // 0.5x
        x0_25_resistance: [] as string[], // 0.25x
        x0_immunity: [] as string[]       // 0x
    };

    for (const [type, multiplier] of Object.entries(multipliers)) {
        if (multiplier === 4) {
            result.x4_weakness.push(type);
        } else if (multiplier === 2) {
            result.x2_weakness.push(type);
        } else if (multiplier === 0.5) {
            result.x0_5_resistance.push(type);
        } else if (multiplier === 0.25) {
            result.x0_25_resistance.push(type);
        } else if (multiplier === 0) {
            result.x0_immunity.push(type);
        }
    }

    return result;
}
