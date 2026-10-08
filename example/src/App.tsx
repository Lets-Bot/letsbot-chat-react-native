import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  LetsBot,
  LetsBotChatView,
  LetsBotProvider,
  useLetsBotUnread,
} from '@letsbot/react-native-chat';

import { loginDemoUser, setupLetsBot } from './letsbot';
import { setupPush } from './push';

setupLetsBot();

function Button({ title, onPress, badge }: { title: string; onPress: () => void; badge?: number }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{title}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Home() {
  const unread = useLetsBotUnread();
  const scheme = useColorScheme();
  const [embedded, setEmbedded] = useState(false);
  const [locale, setLocale] = useState<'en' | 'ar'>('en');

  useEffect(() => setupPush(), []);
  useEffect(() => LetsBot.setTheme(scheme === 'dark' ? 'dark' : 'light'), [scheme]);
  useEffect(() => {
    const subs = [
      LetsBot.on('open', () => LetsBot.setContext({ screen: 'example_home' })),
      LetsBot.on('message', () => undefined), // e.g. play a sound; never log the text
    ];
    return () => subs.forEach((unsubscribe) => unsubscribe());
  }, []);

  if (embedded) {
    return <LetsBotChatView onClose={() => setEmbedded(false)} />;
  }

  return (
    <View style={[styles.screen, scheme === 'dark' && styles.screenDark]}>
      <Text style={[styles.title, scheme === 'dark' && styles.textDark]}>LetsBot In-App Chat</Text>
      <Button title="Open chat (modal)" badge={unread} onPress={() => LetsBot.show()} />
      <Button title="Open chat (embedded)" onPress={() => setEmbedded(true)} />
      <Button
        title={locale === 'en' ? 'Switch chat to Arabic' : 'Switch chat to English'}
        onPress={() => {
          const next = locale === 'en' ? 'ar' : 'en';
          setLocale(next);
          LetsBot.setLocale(next);
        }}
      />
      <Button
        title="Log in (verified identity)"
        onPress={() =>
          loginDemoUser('demo-user-1').then(
            () => Alert.alert('Identified'),
            (error: Error) => Alert.alert('Identify failed', error.message)
          )
        }
      />
      <Button title="Log out" onPress={() => void LetsBot.logout()} />
      <StatusBar style="auto" />
    </View>
  );
}

export default function App() {
  return (
    <LetsBotProvider>
      <Home />
    </LetsBotProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#fff' },
  screenDark: { backgroundColor: '#111315' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12, textAlign: 'center', color: '#1b1d1f' },
  textDark: { color: '#f2f2f2' },
  button: {
    backgroundColor: '#0e7c66',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  badge: {
    marginLeft: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#e5484d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
