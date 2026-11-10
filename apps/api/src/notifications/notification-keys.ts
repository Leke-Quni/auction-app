// What a saved notification is about. A newer one with the same key replaces the older one for that person, and the code that
// takes a notice away (a paid order removes "you won") finds it by the same key, so each key is built here and nowhere else.
export const notificationKey = {
  won: (listingId: string) => `won:${listingId}`,
  outbid: (listingId: string) => `outbid:${listingId}`,
  extended: (listingId: string) => `extended:${listingId}`,
  removed: (listingId: string) => `removed:${listingId}`,
  question: (questionId: string) => `question:${questionId}`,
  answer: (questionId: string) => `answer:${questionId}`,
};
