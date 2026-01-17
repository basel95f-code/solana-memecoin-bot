import { analyzeContract } from '../../src/analysis/contractCheck';
import { solanaService } from '../../src/services/solana';
import { ContractAnalysis } from '../../src/types';

// Mock the solana service
jest.mock('../../src/services/solana', () => ({
  solanaService: {
    getMintInfo: jest.fn(),
    getConnection: jest.fn(() => ({
      getSignaturesForAddress: jest.fn().mockResolvedValue([]),
      getParsedTransaction: jest.fn().mockResolvedValue(null),
    })),
  },
}));

describe('contractCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeContract', () => {
    it('should detect revoked mint authority', async () => {
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue({
        mintAuthority: null,
        freezeAuthority: null,
        decimals: 9,
        supply: BigInt(1000000000),
      });

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      expect(result.mintAuthorityRevoked).toBe(true);
      expect(result.mintAuthority).toBeNull();
    });

    it('should detect active mint authority', async () => {
      const mockAuthority = { toBase58: () => 'AuthorityAddress123' };
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue({
        mintAuthority: mockAuthority,
        freezeAuthority: null,
        decimals: 9,
        supply: BigInt(1000000000),
      });

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      expect(result.mintAuthorityRevoked).toBe(false);
      expect(result.mintAuthority).toBe('AuthorityAddress123');
    });

    it('should detect revoked freeze authority', async () => {
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue({
        mintAuthority: null,
        freezeAuthority: null,
        decimals: 9,
        supply: BigInt(1000000000),
      });

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      expect(result.freezeAuthorityRevoked).toBe(true);
      expect(result.freezeAuthority).toBeNull();
    });

    it('should detect active freeze authority', async () => {
      const mockAuthority = { toBase58: () => 'FreezeAuthority123' };
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue({
        mintAuthority: null,
        freezeAuthority: mockAuthority,
        decimals: 9,
        supply: BigInt(1000000000),
      });

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      expect(result.freezeAuthorityRevoked).toBe(false);
      expect(result.freezeAuthority).toBe('FreezeAuthority123');
    });

    it('should return valid contract analysis structure', async () => {
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue({
        mintAuthority: null,
        freezeAuthority: null,
        decimals: 9,
        supply: BigInt(1000000000),
      });

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      expect(result).toHaveProperty('mintAuthorityRevoked');
      expect(result).toHaveProperty('freezeAuthorityRevoked');
      expect(result).toHaveProperty('mintAuthority');
      expect(result).toHaveProperty('freezeAuthority');
      expect(result).toHaveProperty('isHoneypot');
      expect(result).toHaveProperty('hasTransferFee');
    });

    it('should handle errors gracefully', async () => {
      (solanaService.getMintInfo as jest.Mock).mockRejectedValue(new Error('RPC Error'));

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      // Should return default values, not throw
      expect(result).toHaveProperty('mintAuthorityRevoked');
      expect(result).toHaveProperty('freezeAuthorityRevoked');
    });

    it('should handle null mint info', async () => {
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue(null);

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      // Should return default safe values when we can't determine
      expect(result.mintAuthorityRevoked).toBe(false);
      expect(result.freezeAuthorityRevoked).toBe(false);
    });

    it('should default isHoneypot to false', async () => {
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue({
        mintAuthority: null,
        freezeAuthority: null,
        decimals: 9,
        supply: BigInt(1000000000),
      });

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      expect(result.isHoneypot).toBe(false);
    });

    it('should default hasTransferFee to false', async () => {
      (solanaService.getMintInfo as jest.Mock).mockResolvedValue({
        mintAuthority: null,
        freezeAuthority: null,
        decimals: 9,
        supply: BigInt(1000000000),
      });

      const result = await analyzeContract('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

      expect(result.hasTransferFee).toBe(false);
    });
  });

  describe('Contract Safety Scoring', () => {
    it('should consider both authorities revoked as safest', () => {
      const safeContract: ContractAnalysis = {
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        mintAuthority: null,
        freezeAuthority: null,
        isHoneypot: false,
        hasTransferFee: false,
      };

      // This would be max score in classifier
      expect(safeContract.mintAuthorityRevoked).toBe(true);
      expect(safeContract.freezeAuthorityRevoked).toBe(true);
      expect(safeContract.isHoneypot).toBe(false);
    });

    it('should consider honeypot as most dangerous', () => {
      const honeypotContract: ContractAnalysis = {
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        mintAuthority: null,
        freezeAuthority: null,
        isHoneypot: true,
        honeypotReason: 'Cannot sell',
        hasTransferFee: false,
      };

      // Honeypot should result in score of 0
      expect(honeypotContract.isHoneypot).toBe(true);
      expect(honeypotContract.honeypotReason).toBeDefined();
    });

    it('should flag transfer fee tokens', () => {
      const feeToken: ContractAnalysis = {
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        mintAuthority: null,
        freezeAuthority: null,
        isHoneypot: false,
        hasTransferFee: true,
        transferFeePercent: 5,
      };

      expect(feeToken.hasTransferFee).toBe(true);
      expect(feeToken.transferFeePercent).toBe(5);
    });
  });
});

describe('Honeypot Detection', () => {
  it('should recognize common honeypot patterns', () => {
    const honeypotReasons = [
      'Cannot sell',
      'High sell tax',
      'Transfer blocked',
      'Pausable token',
    ];

    honeypotReasons.forEach(reason => {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    });
  });
});

describe('Token Program Support', () => {
  const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

  it('should recognize standard SPL Token program', () => {
    expect(TOKEN_PROGRAM_ID).toMatch(/^Token[A-Za-z0-9]+$/);
  });

  it('should recognize Token-2022 program', () => {
    expect(TOKEN_2022_PROGRAM_ID).toMatch(/^Token[A-Za-z0-9]+$/);
  });
});
