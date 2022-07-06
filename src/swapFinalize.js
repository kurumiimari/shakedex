class SwapFinalize {
  constructor(options) {
    const { name, finalizeTxHash, broadcastAt } = options;

    this.name = name;
    this.finalizeTxHash = finalizeTxHash;
    this.broadcastAt = broadcastAt;
  }

  async getConfirmationDetails(context) {
    const tx = await context.nodeClient.getTX(this.finalizeTxHash);
    const included = tx.height > -1;
    return {
      confirmedAt: included ? tx.mtime : null,
    };
  }

  toJSON() {
    return {
      name: this.name,
      finalizeTxHash: this.finalizeTxHash,
      broadcastAt: this.broadcastAt,
    };
  }
}

exports.SwapFinalize = SwapFinalize;
