export interface Pokemon {
    id: number;
    national_dex: number;
    name_ko: string;
    name_en: string;
    form_name?: string;
    generation: number;
    image_url?: string;
    is_default: boolean;
}

export interface Type {
    id: number;
    name_ko: string;
    name_en: string;
}

export interface PokemonType {
    pokemon_id: number;
    type_id: number;
    slot: number;
}

export interface Stats {
    pokemon_id: number;
    hp: number;
    attack: number;
    defense: number;
    sp_attack: number;
    sp_defense: number;
    speed: number;
    total: number;
}

export interface Move {
    id: number;
    name_ko: string;
    name_en: string;
    type_id?: number;
    power?: number;
    accuracy?: number;
    pp?: number;
    damage_class?: string;
}

export interface PokemonMove {
    pokemon_id: number;
    move_id: number;
    learn_method: string;
    level_learned?: number;
}

export interface Evolution {
    id?: number;
    from_pokemon_id?: number;
    to_pokemon_id: number;
    trigger: string;
    min_level?: number;
    item?: string;
    condition?: string;
}

// PokeAPI 응답 타입
export interface PokeAPIType {
    name: string;
    url: string;
}

export interface PokeAPIPokemon {
    id: number;
    name: string;
    types: Array<{
        slot: number;
        type: PokeAPIType;
    }>;
    stats: Array<{
        base_stat: number;
        stat: PokeAPIType;
    }>;
    moves: Array<{
        move: PokeAPIType;
        version_group_details: Array<{
            level_learned_at: number;
            move_learn_method: PokeAPIType;
        }>;
    }>;
    sprites: {
        other?: {
            'official-artwork'?: {
                front_default?: string;
            };
        };
    };
    species: PokeAPIType;
}

export interface PokeAPISpecies {
    id: number;
    name: string;
    names: Array<{
        name: string;
        language: PokeAPIType;
    }>;
    generation: PokeAPIType;
    evolution_chain: {
        url: string;
    };
    varieties: Array<{
        is_default: boolean;
        pokemon: PokeAPIType;
    }>;
}

export interface PokeAPIMove {
    id: number;
    name: string;
    names: Array<{
        name: string;
        language: PokeAPIType;
    }>;
    type: PokeAPIType;
    power?: number;
    accuracy?: number;
    pp?: number;
    damage_class: PokeAPIType;
}

export interface PokeAPITypeData {
    id: number;
    name: string;
    names: Array<{
        name: string;
        language: PokeAPIType;
    }>;
}
