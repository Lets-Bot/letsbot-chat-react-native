interface UiStrings {
  unavailable: string;
  offline: string;
  retry: string;
  close: string;
}

const STRINGS: Record<string, UiStrings> = {
  en: {
    unavailable: 'Chat is unavailable right now.',
    offline: 'Check your internet connection and try again.',
    retry: 'Try again',
    close: 'Close',
  },
  ar: {
    unavailable: 'المحادثة غير متاحة حاليًا.',
    offline: 'تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.',
    retry: 'حاول مرة أخرى',
    close: 'إغلاق',
  },
  es: {
    unavailable: 'El chat no está disponible en este momento.',
    offline: 'Comprueba tu conexión a internet e inténtalo de nuevo.',
    retry: 'Reintentar',
    close: 'Cerrar',
  },
  pt: {
    unavailable: 'O chat não está disponível no momento.',
    offline: 'Verifique sua conexão com a internet e tente novamente.',
    retry: 'Tentar novamente',
    close: 'Fechar',
  },
};

/** Native fallback strings (loading / error states) for the four supported locales; English otherwise. */
export function uiStrings(locale: string | undefined): UiStrings {
  return STRINGS[locale ?? 'en'] ?? STRINGS.en!;
}
