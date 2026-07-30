// @cqframework/cql ships generated Kotlin/JS .d.ts files under kotlin/, but its package.json
// exports only point at .mjs entry points.
//
// This shim documents only the types we need, and should be removed if a
// future @cqframework/cql release exposes proper types.
declare module '@cqframework/cql/cql-to-elm' {
	export class ModelManager {
		constructor();
	}

	export class LibraryManager {
		constructor(modelManager: ModelManager);
	}

	export class CqlTranslator {
		static fromText(cql: string, libraryManager: LibraryManager): CqlTranslator;
		toJson(): string;
	}
}
