import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from 'react-native';
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
 *
 * The modal is full screen and edge-to-edge (Android: drawn behind the status and navigation bars): the chat page
 * paints its header colour under the status bar and pads its composer above the home indicator / navigation bar and
 * the keyboard itself.
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
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        {...modalProps}
        visible={visible}
        onRequestClose={close}
      >
        {visible ? <LetsBotChatView {...chatViewProps} onClose={close} /> : null}
      </Modal>
    </>
  );
}
