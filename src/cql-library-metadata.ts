// CQL library metadata for FHIR Library imports.
//
// FHIR Library resources must use the name and version declared in CQL source. We compile with
// @cqframework/cql and read library.identifier from the ELM AST rather than regex-matching the
// header, which is more reliable for quoted names and valid CQL syntax. Callers treat a null
// result as a hard failure (no default version, no import).
import { CqlTranslator, LibraryManager, ModelManager } from '@cqframework/cql/cql-to-elm';

export interface CqlLibraryInfo {
	libraryName: string;
	version: string;
}

interface ElmLibraryDocument {
	library?: {
		identifier?: {
			id?: string;
			version?: string;
		};
	};
}

export function extractCqlLibraryNameAndVersion(content: string): CqlLibraryInfo | null {
	try {
		const modelManager = new ModelManager();
		const libraryManager = new LibraryManager(modelManager);
		const translator = CqlTranslator.fromText(content, libraryManager);
		const elm = JSON.parse(translator.toJson()) as ElmLibraryDocument;
		const libraryName = elm.library?.identifier?.id?.trim();
		const version = elm.library?.identifier?.version?.trim();
		if (!libraryName || !version) {
			return null;
		}
		return { libraryName, version };
	} catch {
		return null;
	}
}
