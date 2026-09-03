import type { FilterQuery } from 'mongoose';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { LegalDocumentModel, type LegalDocumentDoc } from './legal-document.model.js';

export class LegalDocumentRepository extends TenantRepository<LegalDocumentDoc> {
  constructor() {
    super(LegalDocumentModel, 'legalDocument');
  }

  /** La versión más alta ya publicada de este tipo, o `null` si nunca se publicó. */
  async latestOf(type: string): Promise<LegalDocumentDoc | null> {
    return LegalDocumentModel.findOne(this.scope({ type } as FilterQuery<LegalDocumentDoc>))
      .sort({ version: -1 })
      .setOptions(sessionOption())
      .lean<LegalDocumentDoc>()
      .exec();
  }

  /** La versión vigente de cada tipo que se publicó al menos una vez. */
  async currentByType(): Promise<LegalDocumentDoc[]> {
    const docs = await LegalDocumentModel.find(this.scope())
      .sort({ type: 1, version: -1 })
      .setOptions(sessionOption())
      .lean<LegalDocumentDoc[]>()
      .exec();

    const vistos = new Set<string>();
    const vigentes: LegalDocumentDoc[] = [];
    for (const doc of docs) {
      if (vistos.has(doc.type)) continue;
      vistos.add(doc.type);
      vigentes.push(doc);
    }

    return vigentes;
  }
}
