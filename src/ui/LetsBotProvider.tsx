import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal, Platform } from 'react-native';
import type { ModalProps } from 'react-native';

import { core } from '../instance';
import { LetsBotChatView } from './LetsBotChatView';
import type { LetsBotChatViewProps } from './LetsBotChatView';

export interface LetsBotProviderProps {
  children?: ReactNode;
  /** Extra props for the chat `Modal` (e.g. `animationType`, `statusBarTranslucent`). */
  modalProps?: Omit<ModalProps, 'visible' | 'onRequestClose'>;
  /** Props forwarded to the chat view inside the modal. */
  chatViewProps?: Omit<LetsBotChatViewProps, 'onClose'>;
}

/**
 * Mount once near the root of your app. Renders the chat in a modal driven by `LetsBot.show()` / `LetsBot.hide()`
 * and by `LetsBot.handleNotification()`.
 */
export function LetsBotProvider({ children, modalProps, chatViewProps }: LetsBotProviderProps) {
  const [visible, setVisible] = useState(false);

  useEffect(
    () =>
      core.registerPresenter({
        show: () => setVisible(true),
        hide: () => setVisible(false),
      }),
    []
  );

  const close = useCallback(() => setVisible(false), []);

  return (
    <>
      {children}
      <Modal
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        {...modalProps}
        visible={visible}
        onRequestClose={close}
      >
        {visible ? <LetsBotChatView {...chatViewProps} onClose={close} /> : null}
      </Modal>
    </>
  );
}
